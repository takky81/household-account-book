/**
 * 負担の按分。決定表「負担の按分」に対応する（docs/仕様書.md §5.1）。
 *
 * DB 側の public.default_splits() と同じ規則をフロントでも持つ。入力画面で
 * 保存前に按分結果を見せるため。ずれると画面と保存内容が食い違うので、
 * 規則を変えるときは両方を同時に直す。
 */

export type SplitMember = {
  userId: string;
  /** 既定の負担割合の重み。0 以上 */
  weight: number;
  sortOrder: number;
};

export type SplitInput = {
  /** 共有グループのメンバー。個人カテゴリでは使わない */
  members: SplitMember[];
  amount: number;
  kind: 'income' | 'expense';
  /** 支払った人。null は「共用」 */
  payerId: string | null;
  /** 個人カテゴリなら所有者。共有カテゴリなら null */
  ownerId: string | null;
};

export type Split = { userId: string; amount: number };

/**
 * 重みに比例させて整数円に割り付ける。
 * 端数は重みの大きい順に1円ずつ配る。重みが同じなら sortOrder 昇順、
 * それも同じなら userId 昇順。合計は必ず amount に一致する。
 */
export function splitByWeight(members: SplitMember[], amount: number): Split[] {
  const total = members.reduce((sum, m) => sum + m.weight, 0);
  if (members.length === 0 || total <= 0) return [];

  const ordered = [...members].sort(
    (a, b) => b.weight - a.weight || a.sortOrder - b.sortOrder || (a.userId < b.userId ? -1 : 1),
  );
  const base = ordered.map((m) => ({
    userId: m.userId,
    amount: Math.floor((amount * m.weight) / total),
  }));
  let rest = amount - base.reduce((sum, s) => sum + s.amount, 0);
  for (const s of base) {
    if (rest <= 0) break;
    s.amount += 1;
    rest -= 1;
  }
  return base;
}

/** §5.1 の既定按分。個人・収入・共用・重み0 の分岐を含む。 */
export function defaultSplits(input: SplitInput): Split[] {
  const { members, amount, kind, payerId, ownerId } = input;

  // 個人カテゴリは本人が全額
  if (ownerId !== null) return [{ userId: ownerId, amount }];

  // 収入は受け取った本人の 100%。支出用の重みを取り分に流用しない
  if (kind === 'income' && payerId !== null) return [{ userId: payerId, amount }];

  const weighted = members.filter((m) => m.weight > 0);

  // 重み > 0 のメンバーがいないとき。支払者がいれば全額、共用なら全員を重み1で按分
  if (weighted.length === 0) {
    if (payerId !== null) return [{ userId: payerId, amount }];
    return splitByWeight(
      members.map((m) => ({ ...m, weight: 1 })),
      amount,
    );
  }

  return splitByWeight(weighted, amount);
}

/** 1人ぶんだけ入れて、残りを他のメンバーに割り付ける（取引入力画面の補助）。 */
export function fillRemainder(
  members: SplitMember[],
  amount: number,
  fixed: Split[],
): Split[] {
  const fixedSum = fixed.reduce((sum, s) => sum + s.amount, 0);
  const fixedIds = new Set(fixed.map((s) => s.userId));
  const rest = members.filter((m) => !fixedIds.has(m.userId));
  const filled = splitByWeight(
    rest.map((m) => ({ ...m, weight: m.weight > 0 ? m.weight : 1 })),
    amount - fixedSum,
  );
  return [...fixed, ...filled];
}

/** 負担の合計が金額に一致するか。保存前の検査に使う。 */
export function isBalanced(splits: Split[], amount: number): boolean {
  return splits.reduce((sum, s) => sum + s.amount, 0) === amount;
}
