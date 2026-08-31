/**
 * 共有グループとメンバー（決定表「共有グループの管理」列2・列4・列5・列7・列9・列10）。
 *
 * DB 側の RPC も同じ検査を持つ（§2.7）。ここは押す前に画面で知らせるためのもの。
 */

import type { Validation } from '../auth/validation';

export type MemberLike = { userId: string; defaultWeight: number; sortOrder: number };

/** 個人カテゴリを表す予約語。グループ名には使えない（§3.2）。 */
export const RESERVED_GROUP_NAME = '個人';

/** グループ名として使えるか（列5）。 */
export function validateGroupName(raw: string): Validation {
  if (raw !== raw.trim()) return { ok: false, message: '名前の前後に空白は使えません' };
  if (raw === '') return { ok: false, message: 'グループ名を入力してください' };
  if (raw === RESERVED_GROUP_NAME) {
    return { ok: false, message: `「${RESERVED_GROUP_NAME}」は個人を表す言葉なので使えません` };
  }
  return { ok: true };
}

/** 新しいグループを作れるか（列2・列4・列5）。 */
export function validateNewGroup(input: {
  name: string;
  memberIds: string[];
  selfId: string;
  existingNames: string[];
}): Validation {
  const name = validateGroupName(input.name);
  if (!name.ok) return name;
  if (input.existingNames.includes(input.name)) {
    return { ok: false, message: '同じ名前のグループがあります' };
  }
  // 自分が入っていないと、作った本人から見えないグループができる
  if (!input.memberIds.includes(input.selfId)) {
    return { ok: false, message: '自分自身をメンバーに含めてください' };
  }
  return { ok: true };
}

/** メンバーを追加できるか（列7）。 */
export function canAddMember(members: MemberLike[], userId: string): Validation {
  if (members.some((m) => m.userId === userId)) {
    return { ok: false, message: 'すでにメンバーです' };
  }
  return { ok: true };
}

/**
 * メンバーを外せるか（列9・列10）。
 * 0人になると誰からも見えず、配下の取引ごと復旧できなくなる。
 */
export function canRemoveMember(members: MemberLike[], _userId: string): Validation {
  if (members.length <= 1) return { ok: false, message: '最後のメンバーは外せません' };
  return { ok: true };
}
