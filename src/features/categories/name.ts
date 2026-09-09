/**
 * カテゴリ名（決定表「カテゴリの管理」列3・列4・列5・列6）。
 *
 * カテゴリは全ユーザー共通なので、大分類の名前は収支区分ごとに全体で一意。
 * DB 側は部分一意インデックスで同じことを守っている（§3.4）。
 * ここは保存する前に画面で知らせるための判定。
 */

import type { Validation } from '../auth/validation';

export type Kind = 'income' | 'expense';

export type CategoryLike = {
  id: string;
  /** 親カテゴリ。null なら大分類（§3.4.1） */
  parentId: string | null;
  kind: Kind;
  name: string;
  isArchived: boolean;
};

/** 取引・予算・ルールが持つ共有範囲（§2.4）。カテゴリはもう持たない。 */
export type Scope = { shareGroupId: string | null; ownerId: string | null };

/** 共有範囲を1つの文字列にする。並べ替えや突き合わせに使う。 */
export function scopeKey(shareGroupId: string | null, ownerId: string | null): string {
  return shareGroupId !== null ? `group:${shareGroupId}` : `own:${ownerId}`;
}

/** 前後の空白を落とす。DB も trim 済みの値しか受け取らない（§3.4）。 */
export function normalizeCategoryName(raw: string): string {
  return raw.trim();
}

/** 名前として使えるか（列6）。 */
export function validateCategoryName(raw: string): Validation {
  const name = normalizeCategoryName(raw);
  if (name === '') return { ok: false, message: 'カテゴリ名を入力してください' };
  return { ok: true };
}

/**
 * 同じ名前が既にあるか（列3・列4・列5・列16・列17）。
 *
 * 大分類は同じ収支区分の大分類どうしで全体を見る。小分類は同じ親の中だけ
 * （小分類の収支区分は親と一致するため、親だけで決まる。§3.4）。
 * アーカイブ済みも一意性の判定に含める。画面に出ていないカテゴリと衝突しうる。
 */
export function findNameConflict(
  categories: CategoryLike[],
  target: { kind: Kind; name: string; parentId?: string | null },
  exceptId?: string,
): CategoryLike | null {
  const name = normalizeCategoryName(target.name);
  const parentId = target.parentId ?? null;
  return (
    categories.find((c) => {
      if (c.id === exceptId || c.name !== name) return false;
      if (parentId !== null) return c.parentId === parentId;
      return c.parentId === null && c.kind === target.kind;
    }) ?? null
  );
}
