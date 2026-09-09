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
 * 前回の残りを消す。取引 → 定期登録ルール → 予算 → 未分類以外のカテゴリ → グループ の順。
 * transactions.category_id と recurring_rules.category_id は restrict なので、
 * どちらも先に消さないとカテゴリを消せない。
 */
export async function resetData(): Promise<void> {
  const db = adminClient();
  const all = '00000000-0000-0000-0000-000000000000';
  for (const step of [
    db.from('transactions').delete().neq('id', all),
    db.from('recurring_rules').delete().neq('id', all),
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
  // 未分類は全ユーザー共通で収支区分ごとに1件（§3.4）。グループごとには作らない
  return id;
}

/** カテゴリを1件作る。 */
/**
 * 呼び出した人が入っていないグループ。参照できない共有範囲を再現するために使う。
 */
export async function seedForeignGroup(name: string, memberId: string): Promise<string> {
  const db = adminClient();
  const group = await db.from('share_groups').insert({ name }).select('id').single();
  if (group.error !== null) throw group.error;
  const id = group.data.id as string;
  const member = await db
    .from('share_group_members')
    .insert({ share_group_id: id, user_id: memberId, default_weight: 1, sort_order: 10 });
  if (member.error !== null) throw member.error;
  return id;
}

/** カテゴリを1件作る。カテゴリは全ユーザー共通なので共有範囲を持たない（§2.4）。 */
export async function seedCategory(input: {
  kind?: 'income' | 'expense';
  name: string;
  /** 小分類にするときの親。収支区分は親からコピーされる */
  parentId?: string | null;
  sortOrder?: number;
}): Promise<string> {
  const { data, error } = await adminClient()
    .from('categories')
    .insert({
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
  /** 共有範囲。グループなら shareGroupId、個人なら ownerId のどちらか一方（§2.4） */
  shareGroupId?: string | null;
  ownerId?: string | null;
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
      share_group_id: input.shareGroupId ?? null,
      owner_id: input.shareGroupId == null ? (input.ownerId ?? input.createdBy) : null,
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

export async function seedBudget(input: {
  categoryId: string;
  shareGroupId?: string | null;
  ownerId?: string | null;
  month: string;
  amount: number;
}): Promise<void> {
  const { error } = await adminClient().from('budgets').insert({
    category_id: input.categoryId,
    share_group_id: input.shareGroupId ?? null,
    owner_id: input.shareGroupId == null ? (input.ownerId ?? null) : null,
    month: input.month,
    amount: input.amount,
  });
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

/** 未分類カテゴリの id。収支区分ごとに全体で1件（§3.4）。 */
export async function systemCategoryOf(kind: 'income' | 'expense'): Promise<string> {
  const { data, error } = await adminClient()
    .from('categories')
    .select('id')
    .eq('kind', kind)
    .eq('is_system', true)
    .single();
  if (error !== null) throw error;
  return data.id as string;
}

/** 定期登録ルールを1件作る（§3.8）。created_by は既定値が入らないので必ず渡す。 */
export async function seedRecurringRule(input: {
  categoryId: string;
  shareGroupId?: string | null;
  ownerId?: string | null;
  createdBy: string;
  payerId: string | null;
  amount: number;
  dayOfMonth: number;
  /** 対象月（YYYY-MM）。DB には月初の日付で入れる */
  startMonth: string;
  endMonth?: string | null;
  memo?: string;
  isPaused?: boolean;
  splits?: { userId: string; amount: number }[];
}): Promise<string> {
  const db = adminClient();
  const rule = await db
    .from('recurring_rules')
    .insert({
      category_id: input.categoryId,
      share_group_id: input.shareGroupId ?? null,
      owner_id: input.shareGroupId == null ? (input.ownerId ?? input.createdBy) : null,
      created_by: input.createdBy,
      payer_id: input.payerId,
      amount: input.amount,
      day_of_month: input.dayOfMonth,
      start_month: `${input.startMonth}-01`,
      end_month: input.endMonth == null ? null : `${input.endMonth}-01`,
      memo: input.memo ?? '',
      is_paused: input.isPaused ?? false,
      splits_are_manual: input.splits !== undefined,
    })
    .select('id')
    .single();
  if (rule.error !== null) throw rule.error;
  const id = rule.data.id as string;
  if (input.splits !== undefined) {
    const splits = await db
      .from('recurring_rule_splits')
      .insert(input.splits.map((s) => ({ rule_id: id, user_id: s.userId, amount: s.amount })));
    if (splits.error !== null) throw splits.error;
  }
  return id;
}

export async function countTransactions(categoryId: string): Promise<number> {
  const { count, error } = await adminClient()
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .eq('category_id', categoryId);
  if (error !== null) throw error;
  return count ?? 0;
}

export async function countRecurringPostings(ruleId: string): Promise<number> {
  const { count, error } = await adminClient()
    .from('recurring_postings')
    .select('rule_id', { count: 'exact', head: true })
    .eq('rule_id', ruleId);
  if (error !== null) throw error;
  return count ?? 0;
}

/** 生成された取引を消す（意図して消したものが戻らないことを確かめる）。 */
export async function deleteTransactionsOf(categoryId: string): Promise<void> {
  const { error } = await adminClient()
    .from('transactions')
    .delete()
    .eq('category_id', categoryId);
  if (error !== null) throw error;
}

export async function archiveCategory(categoryId: string): Promise<void> {
  const { error } = await adminClient()
    .from('categories')
    .update({ is_archived: true })
    .eq('id', categoryId);
  if (error !== null) throw error;
}
