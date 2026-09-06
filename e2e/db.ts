import { execFileSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { HANA, OTHER, SUPABASE_URL, TARO } from './env';

/** ローカル Supabase の service_role キーを取り出す。E2E の前準備と後片付けだけに使う。 */
export function serviceRoleKey(): string {
  const out = execFileSync('npx', ['supabase', 'status', '-o', 'json'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  const status = JSON.parse(out) as { SERVICE_ROLE_KEY: string };
  return status.SERVICE_ROLE_KEY;
}

let admin: SupabaseClient | null = null;

/** RLS を迂回する管理用クライアント。 */
export function adminClient(): SupabaseClient {
  if (admin === null) {
    admin = createClient(SUPABASE_URL, serviceRoleKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}

/** 利用者の id を返す。無ければ作る（サインアップは閉じているので管理 API から）。 */
export async function ensureUser(user: { email: string; password: string }): Promise<string> {
  const db = adminClient();
  const { data, error } = await db.auth.admin.listUsers();
  if (error !== null) throw error;

  const existing = data.users.find((u) => u.email === user.email);
  if (existing !== undefined) return existing.id;

  const created = await db.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
  });
  if (created.error !== null) throw created.error;
  return created.data.user.id;
}

/** パスワードを差し替える。変更のテストが後続へ影響しないよう戻すのに使う。 */
export async function setPassword(email: string, password: string): Promise<void> {
  const db = adminClient();
  const { data, error } = await db.auth.admin.listUsers();
  if (error !== null) throw error;
  const user = data.users.find((u) => u.email === email);
  if (user === undefined) throw new Error(`利用者が見つかりません: ${email}`);
  const updated = await db.auth.admin.updateUserById(user.id, { password });
  if (updated.error !== null) throw updated.error;
}

export type TestUsers = { taro: string; hana: string; other: string };

export async function ensureUsers(): Promise<TestUsers> {
  return {
    taro: await ensureUser(TARO),
    hana: await ensureUser(HANA),
    other: await ensureUser(OTHER),
  };
}

/**
 * 前回の残りを消す。取引 → 予算 → 未分類以外のカテゴリ → グループ の順。
 * transactions.category_id は restrict なので、取引を先に消さないとカテゴリを消せない。
 */
export async function resetData(): Promise<void> {
  const db = adminClient();
  const all = '00000000-0000-0000-0000-000000000000';
  for (const step of [
    db.from('transactions').delete().neq('id', all),
    db.from('budgets').delete().neq('id', all),
    db.from('categories').delete().eq('is_system', false),
    db.from('share_groups').delete().neq('id', all),
  ]) {
    const { error } = await step;
    if (error !== null) throw error;
  }
  // 既定カテゴリの参照も外しておく
  const { error } = await db.from('profiles').update({ default_category_id: null }).neq('id', all);
  if (error !== null) throw error;
}

/** 夫婦グループ（たかし・はなこ、折半）を作る。 */
export async function seedGroup(users: TestUsers, name = '夫婦'): Promise<string> {
  const db = adminClient();
  const group = await db.from('share_groups').insert({ name }).select('id').single();
  if (group.error !== null) throw group.error;
  const id = group.data.id as string;
  const members = await db.from('share_group_members').insert([
    { share_group_id: id, user_id: users.taro, default_weight: 1, sort_order: 10 },
    { share_group_id: id, user_id: users.hana, default_weight: 1, sort_order: 20 },
  ]);
  if (members.error !== null) throw members.error;
  const systemCategories = await db.from('categories').insert([
    { share_group_id: id, kind: 'expense', name: '未分類', is_system: true, sort_order: 9999 },
    { share_group_id: id, kind: 'income', name: '未分類', is_system: true, sort_order: 9999 },
  ]);
  if (systemCategories.error !== null) throw systemCategories.error;
  return id;
}

/** カテゴリを1件作る。 */
export async function seedCategory(input: {
  shareGroupId?: string | null;
  ownerId?: string | null;
  kind?: 'income' | 'expense';
  name: string;
  /** 小分類にするときの親。共有範囲と収支区分は親からコピーされる */
  parentId?: string | null;
  sortOrder?: number;
}): Promise<string> {
  const { data, error } = await adminClient()
    .from('categories')
    .insert({
      share_group_id: input.shareGroupId ?? null,
      owner_id: input.ownerId ?? null,
      kind: input.kind ?? 'expense',
      name: input.name,
      parent_id: input.parentId ?? null,
      sort_order: input.sortOrder ?? 10,
    })
    .select('id')
    .single();
  if (error !== null) throw error;
  return data.id as string;
}

/** 取引を1件作る。負担は明示する。 */
export async function seedTransaction(input: {
  categoryId: string;
  payerId: string | null;
  createdBy: string;
  occurredOn: string;
  amount: number;
  memo?: string;
  splits: { userId: string; amount: number }[];
}): Promise<string> {
  const db = adminClient();
  const tx = await db
    .from('transactions')
    .insert({
      category_id: input.categoryId,
      payer_id: input.payerId,
      created_by: input.createdBy,
      occurred_on: input.occurredOn,
      amount: input.amount,
      memo: input.memo ?? '',
    })
    .select('id')
    .single();
  if (tx.error !== null) throw tx.error;
  const id = tx.data.id as string;
  const splits = await db.from('transaction_splits').insert(
    input.splits.map((s) => ({ transaction_id: id, user_id: s.userId, amount: s.amount })),
  );
  if (splits.error !== null) throw splits.error;
  return id;
}

export async function seedBudget(categoryId: string, month: string, amount: number): Promise<void> {
  const { error } = await adminClient()
    .from('budgets')
    .insert({ category_id: categoryId, month, amount });
  if (error !== null) throw error;
}

export async function countBudgets(categoryId: string): Promise<number> {
  const { count, error } = await adminClient()
    .from('budgets')
    .select('id', { count: 'exact', head: true })
    .eq('category_id', categoryId);
  if (error !== null) throw error;
  return count ?? 0;
}

/** 個人の未分類カテゴリ（収入・支出）の id。 */
export async function systemCategoryOf(ownerId: string, kind: 'income' | 'expense'): Promise<string> {
  const { data, error } = await adminClient()
    .from('categories')
    .select('id')
    .eq('owner_id', ownerId)
    .eq('kind', kind)
    .eq('is_system', true)
    .single();
  if (error !== null) throw error;
  return data.id as string;
}
