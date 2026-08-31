/**
 * カテゴリ名と共有範囲（決定表「カテゴリの管理」列3・列4・列5・列6）。
 *
 * DB 側は共有範囲ごとの部分一意インデックスで同じことを守っている（§3.4）。
 * ここは保存する前に画面で知らせるための判定。
 */

import type { Validation } from '../auth/validation';

export type Kind = 'income' | 'expense';

export type CategoryLike = {
  id: string;
  shareGroupId: string | null;
  ownerId: string | null;
  kind: Kind;
  name: string;
  isArchived: boolean;
};

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
 * 同じ共有範囲・同じ収支区分に同じ名前があるか（列3・列4・列5）。
 * アーカイブ済みも一意性の判定に含める。画面に出ていないカテゴリと衝突しうる。
 */
export function findNameConflict(
  categories: CategoryLike[],
  target: Scope & { kind: Kind; name: string },
  exceptId?: string,
): CategoryLike | null {
  const key = scopeKey(target.shareGroupId, target.ownerId);
  const name = normalizeCategoryName(target.name);
  return (
    categories.find(
      (c) =>
        c.id !== exceptId &&
        scopeKey(c.shareGroupId, c.ownerId) === key &&
        c.kind === target.kind &&
        c.name === name,
    ) ?? null
  );
}
