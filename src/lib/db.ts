/**
 * Supabase への問い合わせ（docs/仕様書.md §2.6 / §2.7）。
 *
 * 書き込みのうち、複数行にまたがる不変条件を持つものは RPC に閉じてある。
 * 直接 INSERT / UPDATE できるのは、権限表で列を grant してあるものだけ。
 */

import { supabase } from './supabase';
import { fetchAll, PAGE_SIZE } from './paged';
import { monthEnd, monthStart } from './date';
import type { Kind } from '../features/categories/name';
import type { Split } from './split';

export type Profile = {
  id: string;
  display_name: string;
  color: string;
  default_category_id: string | null;
};

export type ShareGroup = { id: string; name: string };

export type GroupMember = {
  share_group_id: string;
  user_id: string;
  default_weight: number;
  sort_order: number;
};

export type Category = {
  id: string;
  /** 親カテゴリ。null なら大分類（§3.4.1） */
  parent_id: string | null;
  share_group_id: string | null;
  owner_id: string | null;
  kind: Kind;
  name: string;
  color: string;
  sort_order: number;
  is_system: boolean;
  is_archived: boolean;
};

export type Transaction = {
  id: string;
  category_id: string;
  payer_id: string | null;
  created_by: string;
  occurred_on: string;
  amount: number;
  splits_are_manual: boolean;
  memo: string;
  transaction_splits: { user_id: string; amount: number }[];
};

export type Budget = { id: string; category_id: string; month: string; amount: number };

/** 画面をまたいで使う、量の少ないデータ。ログインのたびにまとめて読む。 */
export type Workspace = {
  profiles: Profile[];
  groups: ShareGroup[];
  members: GroupMember[];
  categories: Category[];
};

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error !== null) throw new Error(result.error.message);
  if (result.data === null) throw new Error('データが取れませんでした');
  return result.data;
}

export async function loadWorkspace(): Promise<Workspace> {
  const [profiles, groups, members, categories] = await Promise.all([
    supabase.from('profiles').select('id, display_name, color, default_category_id'),
    supabase.from('share_groups').select('id, name').order('name'),
    supabase.from('share_group_members').select('*').order('sort_order'),
    supabase.from('categories').select('*').order('sort_order').order('name'),
  ]);
  return {
    profiles: unwrap(profiles) as Profile[],
    groups: unwrap(groups) as ShareGroup[],
    members: unwrap(members) as GroupMember[],
    categories: unwrap(categories) as Category[],
  };
}

const TX_COLUMNS = '*, transaction_splits(user_id, amount)';

/**
 * 取引を範囲で取る。上限を超えてもエラーにならず黙って打ち切られるため、
 * 件数を見ながら分割して取り切る（§5.7）。
 */
export async function loadTransactions(range: {
  from?: string;
  to?: string;
}): Promise<Transaction[]> {
  return fetchAll<Transaction>(async (from, to) => {
    let query = supabase
      .from('transactions')
      .select(TX_COLUMNS, { count: 'exact' })
      .order('occurred_on', { ascending: false })
      .order('id');
    if (range.from !== undefined) query = query.gte('occurred_on', range.from);
    if (range.to !== undefined) query = query.lte('occurred_on', range.to);
    const { data, error, count } = await query.range(from, to);
    if (error !== null) throw new Error(error.message);
    return { rows: (data ?? []) as Transaction[], total: count };
  }, PAGE_SIZE);
}

export function loadMonthTransactions(monthKey: string): Promise<Transaction[]> {
  return loadTransactions({ from: monthStart(monthKey), to: monthEnd(monthKey) });
}

export async function loadBudgets(monthKeys: string[]): Promise<Budget[]> {
  const { data, error } = await supabase
    .from('budgets')
    .select('*')
    .in('month', monthKeys.map(monthStart));
  if (error !== null) throw new Error(error.message);
  return (data ?? []) as Budget[];
}

// ------------------------------------------------------------------ 書き込み

export type SaveTransaction = {
  id?: string;
  categoryId: string;
  occurredOn: string;
  amount: number;
  payerId: string | null;
  memo: string;
  /** 渡すと手入力の負担として扱う。省略すると RPC が既定割合で按分する */
  splits?: Split[];
};

export async function saveTransaction(input: SaveTransaction): Promise<string> {
  const { data, error } = await supabase.rpc('upsert_transaction', {
    p_category_id: input.categoryId,
    p_occurred_on: input.occurredOn,
    p_amount: input.amount,
    p_payer_id: input.payerId,
    p_memo: input.memo,
    p_splits:
      input.splits === undefined
        ? null
        : input.splits.map((s) => ({ user_id: s.userId, amount: s.amount })),
    p_id: input.id ?? null,
  });
  if (error !== null) throw new Error(error.message);
  return data as string;
}

export async function deleteTransaction(id: string): Promise<void> {
  const { error } = await supabase.from('transactions').delete().eq('id', id);
  if (error !== null) throw new Error(error.message);
}

export async function createCategory(input: {
  shareGroupId: string | null;
  kind: Kind;
  name: string;
  color: string;
  sortOrder: number;
  /** 小分類として作るときの親。共有範囲と収支区分は親からコピーされる（§3.4.1） */
  parentId?: string | null;
}): Promise<void> {
  // owner_id / created_by / is_system は既定値とトリガが入れる（列を grant していない）
  const { error } = await supabase.from('categories').insert({
    share_group_id: input.shareGroupId,
    kind: input.kind,
    name: input.name,
    color: input.color,
    sort_order: input.sortOrder,
    parent_id: input.parentId ?? null,
  });
  if (error !== null) throw new Error(error.message);
}

export async function updateCategory(
  id: string,
  patch: { name?: string; color?: string; sort_order?: number; is_archived?: boolean },
): Promise<void> {
  const { error } = await supabase.from('categories').update(patch).eq('id', id);
  if (error !== null) throw new Error(error.message);
}

export async function deleteCategory(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_category', { p_category_id: id });
  if (error !== null) throw new Error(error.message);
}

export async function moveCategoryScope(input: {
  categoryId: string;
  destShareGroupId: string | null;
  destOwnerId: string | null;
  merge: boolean;
}): Promise<void> {
  const { error } = await supabase.rpc('move_category_scope', {
    p_category_id: input.categoryId,
    p_dest_share_group_id: input.destShareGroupId,
    p_dest_owner_id: input.destOwnerId,
    p_merge: input.merge,
  });
  if (error !== null) throw new Error(error.message);
}

export async function moveTransactions(ids: string[], destCategoryId: string): Promise<void> {
  const { error } = await supabase.rpc('move_transactions', {
    p_transaction_ids: ids,
    p_dest_category_id: destCategoryId,
  });
  if (error !== null) throw new Error(error.message);
}

export async function createShareGroup(input: {
  name: string;
  members: { userId: string; defaultWeight: number; sortOrder: number }[];
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_share_group', {
    p_name: input.name,
    p_members: input.members.map((m) => ({
      user_id: m.userId,
      default_weight: m.defaultWeight,
      sort_order: m.sortOrder,
    })),
  });
  if (error !== null) throw new Error(error.message);
  return data as string;
}

export async function addGroupMember(input: {
  shareGroupId: string;
  userId: string;
  defaultWeight: number;
  sortOrder: number;
}): Promise<void> {
  const { error } = await supabase.rpc('add_group_member', {
    p_share_group_id: input.shareGroupId,
    p_user_id: input.userId,
    p_default_weight: input.defaultWeight,
    p_sort_order: input.sortOrder,
  });
  if (error !== null) throw new Error(error.message);
}

export async function removeGroupMember(shareGroupId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_group_member', {
    p_share_group_id: shareGroupId,
    p_user_id: userId,
  });
  if (error !== null) throw new Error(error.message);
}

export async function deleteShareGroup(shareGroupId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_share_group', {
    p_share_group_id: shareGroupId,
  });
  if (error !== null) throw new Error(error.message);
}

export async function updateGroupName(id: string, name: string): Promise<void> {
  const { error } = await supabase.from('share_groups').update({ name }).eq('id', id);
  if (error !== null) throw new Error(error.message);
}

export async function updateMemberWeight(input: {
  shareGroupId: string;
  userId: string;
  defaultWeight: number;
}): Promise<void> {
  const { error } = await supabase
    .from('share_group_members')
    .update({ default_weight: input.defaultWeight })
    .eq('share_group_id', input.shareGroupId)
    .eq('user_id', input.userId);
  if (error !== null) throw new Error(error.message);
}

export async function saveBudget(input: {
  categoryId: string;
  month: string;
  amount: number;
}): Promise<void> {
  // upsert（on conflict do update）は category_id と month の UPDATE 権限まで要求するが、
  // budgets に許しているのは amount の更新だけ。更新してから、無ければ入れる（§2.6）
  const updated = await supabase
    .from('budgets')
    .update({ amount: input.amount })
    .eq('category_id', input.categoryId)
    .eq('month', input.month)
    .select('id');
  if (updated.error !== null) throw new Error(updated.error.message);
  if ((updated.data ?? []).length > 0) return;

  const inserted = await supabase
    .from('budgets')
    .insert({ category_id: input.categoryId, month: input.month, amount: input.amount });
  if (inserted.error !== null) throw new Error(inserted.error.message);
}

export async function deleteBudget(categoryId: string, month: string): Promise<void> {
  const { error } = await supabase
    .from('budgets')
    .delete()
    .eq('category_id', categoryId)
    .eq('month', month);
  if (error !== null) throw new Error(error.message);
}

export async function updateProfile(
  id: string,
  patch: { display_name?: string; color?: string; default_category_id?: string | null },
): Promise<void> {
  const { error } = await supabase.from('profiles').update(patch).eq('id', id);
  if (error !== null) throw new Error(error.message);
}

export async function importTransactions(
  rows: {
    categoryId: string;
    occurredOn: string;
    amount: number;
    payerId: string | null;
    memo: string;
    splits: Split[];
  }[],
): Promise<number> {
  const { data, error } = await supabase.rpc('import_transactions', {
    p_rows: rows.map((row) => ({
      category_id: row.categoryId,
      occurred_on: row.occurredOn,
      amount: row.amount,
      payer_id: row.payerId,
      memo: row.memo,
      splits: row.splits.map((s) => ({ user_id: s.userId, amount: s.amount })),
    })),
  });
  if (error !== null) throw new Error(error.message);
  return (data as { inserted: number }).inserted;
}
