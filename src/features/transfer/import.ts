/**
 * CSV の取り込み（docs/仕様書.md §4.4）。決定表「CSVインポート」に対応する。
 *
 * 全行を先に検証し、通った行だけを RPC に渡す。投入そのものが途中で失敗しないよう、
 * DB 側の制約に当たるもの（負担の重複・負の負担額・金額の下限）もここで見る。
 */

import { parseCsvRows } from '../../lib/csv';
import { parseAmount } from '../../lib/money';
import { defaultSplits, type Split } from '../../lib/split';
import type { MemberLike } from '../groups/members';
import { normalizeCategoryName, type CategoryLike, type Kind } from '../categories/name';
import { OWN_LABEL, SHARED_LABEL } from './export';

export type ExistingTx = {
  occurredOn: string;
  categoryId: string;
  amount: number;
  payerId: string | null;
  memo: string;
  splits: Split[];
};

export type ImportContext = {
  selfId: string;
  profiles: { id: string; displayName: string }[];
  groups: { id: string; name: string }[];
  /** グループごとのメンバー。負担の既定按分に使う */
  members: Record<string, MemberLike[]>;
  categories: (CategoryLike & { isSystem?: boolean })[];
  existing: ExistingTx[];
  /** 未知のカテゴリ名をどう扱うか（列7・列8） */
  unknownCategory: 'create' | 'uncategorized';
  /** 既にある取引と同じ内容の行をどう扱うか（列4） */
  duplicates: 'import' | 'skip';
};

export type NewCategory = {
  shareGroupId: string | null;
  ownerId: string | null;
  kind: Kind;
  name: string;
  /** 小分類として作る場合の親。大分類ごと未知なら null（列19） */
  parentId: string | null;
};

export type ImportPayload = {
  categoryId: string | null;
  /** 未知のカテゴリを作る場合の中身（列8・列19）。作るのは一番深い1件だけ */
  newCategory: NewCategory | null;
  occurredOn: string;
  amount: number;
  payerId: string | null;
  memo: string;
  splits: Split[];
};

export type ImportEntry =
  | { line: number; status: 'ok'; payload: ImportPayload }
  | { line: number; status: 'skip'; message: string }
  | { line: number; status: 'error'; message: string };

export type ImportResult = {
  entries: ImportEntry[];
  counts: { ok: number; skipped: number; error: number };
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** DB の share_group_members と、按分が使う形の橋渡し。 */
function toSplitMembers(members: MemberLike[]) {
  return members.map((m) => ({ userId: m.userId, weight: m.defaultWeight, sortOrder: m.sortOrder }));
}

function parseSplits(
  raw: string,
  nameToId: Map<string, string>,
): { ok: true; splits: Split[] } | { ok: false; message: string } {
  const splits: Split[] = [];
  for (const part of raw.split(';')) {
    const text = part.trim();
    if (text === '') continue;
    const at = text.lastIndexOf(':');
    if (at < 0) return { ok: false, message: `負担の書き方が違います: ${text}` };
    const name = text.slice(0, at).trim();
    const amount = Number(text.slice(at + 1).trim());
    const userId = nameToId.get(name);
    if (userId === undefined) return { ok: false, message: `負担の相手が見つかりません: ${name}` };
    if (!Number.isInteger(amount)) return { ok: false, message: `負担額が整数ではありません: ${text}` };
    if (amount < 0) return { ok: false, message: '負担額に0未満のものがあります' };
    splits.push({ userId, amount });
  }
  if (new Set(splits.map((s) => s.userId)).size !== splits.length) {
    return { ok: false, message: '負担に同じ人が2回現れています' };
  }
  return { ok: true, splits };
}

function sameSplits(a: Split[], b: Split[]): boolean {
  if (a.length !== b.length) return false;
  const key = (s: Split[]) =>
    [...s].sort((x, y) => (x.userId < y.userId ? -1 : 1)).map((x) => `${x.userId}:${x.amount}`).join(';');
  return key(a) === key(b);
}

export function analyzeImport(text: string, context: ImportContext): ImportResult {
  const { rows } = parseCsvRows(text);
  const nameToId = new Map(context.profiles.map((p) => [p.displayName, p.id]));
  const groupByName = new Map(context.groups.map((g) => [g.name, g.id]));
  const entries: ImportEntry[] = [];

  rows.forEach((row, index) => {
    // ヘッダが1行目なので、CSV の行番号は index + 2
    const line = index + 2;
    const error = (message: string): void => {
      entries.push({ line, status: 'error', message });
    };

    const occurredOn = (row['日付'] ?? '').trim();
    if (!DATE.test(occurredOn)) return error('日付の書式が正しくありません');

    const kindText = (row['収支'] ?? '').trim();
    if (kindText !== '収入' && kindText !== '支出') return error('収支は 収入 か 支出 にしてください');
    const kind: Kind = kindText === '収入' ? 'income' : 'expense';

    const amount = parseAmount(row['金額'] ?? '');
    if (amount === null) return error('金額は1以上の整数にしてください');

    // 共有範囲。存在しないグループは自動で作らない（列9）
    const scopeText = (row['共有範囲'] ?? '').trim();
    let shareGroupId: string | null = null;
    let ownerId: string | null = null;
    if (scopeText === OWN_LABEL || scopeText === '') {
      ownerId = context.selfId;
    } else {
      const found = groupByName.get(scopeText);
      if (found === undefined) return error(`共有グループが見つかりません: ${scopeText}`);
      if (context.members[found] === undefined) return error(`そのグループのメンバーではありません: ${scopeText}`);
      shareGroupId = found;
    }
    const isPersonal = shareGroupId === null;

    // 支払者
    const payerText = (row['支払者'] ?? '').trim();
    let payerId: string | null = null;
    if (payerText === SHARED_LABEL) {
      if (isPersonal) return error('個人の取引に共用払いは使えません');
    } else {
      const found = nameToId.get(payerText);
      if (found === undefined) return error(`支払者が見つかりません: ${payerText}`);
      payerId = found;
    }
    const memberIds = isPersonal
      ? [context.selfId]
      : (context.members[shareGroupId!] ?? []).map((m) => m.userId);
    if (payerId !== null && !memberIds.includes(payerId)) {
      return error('支払者がその共有範囲のメンバーではありません');
    }

    // カテゴリ。共有範囲 + 収支 + 名前で大分類を引き、小分類はその親の中で引く（§4.4）。
    // 小分類の列は無くてもよい（下位分類を入れる前に書き出したファイルのため）
    const name = normalizeCategoryName(row['カテゴリ'] ?? '');
    const subName = normalizeCategoryName(row['小分類'] ?? '');
    const inScope = context.categories.filter(
      (c) =>
        (c.parentId ?? null) === null &&
        c.shareGroupId === shareGroupId &&
        c.ownerId === ownerId &&
        c.kind === kind,
    );
    const root = inScope.find((c) => c.name === name) ?? null;
    const child =
      root === null || subName === ''
        ? null
        : (context.categories.find((c) => c.parentId === root.id && c.name === subName) ?? null);

    let categoryId: string | null = subName === '' ? (root?.id ?? null) : (child?.id ?? null);
    let newCategory: NewCategory | null = null;
    if (categoryId === null) {
      if (name !== '' && context.unknownCategory === 'create') {
        // 一番深い未知の1件を作る。大分類ごと未知なら、まず大分類から
        newCategory =
          root === null
            ? { shareGroupId, ownerId, kind, name, parentId: null }
            : { shareGroupId, ownerId, kind, name: subName, parentId: root.id };
      } else {
        // 未分類にするときは小分類を捨てて、その共有範囲の未分類（大分類）へ付ける
        const fallback = inScope.find((c) => c.isSystem === true);
        if (fallback === undefined) return error('その共有範囲の未分類カテゴリが見つかりません');
        categoryId = fallback.id;
      }
    }

    // 負担。空欄なら既定按分（列2）
    const rawSplits = (row['負担'] ?? '').trim();
    let splits: Split[];
    if (rawSplits === '') {
      splits = defaultSplits({
        members: isPersonal ? [] : toSplitMembers(context.members[shareGroupId!] ?? []),
        amount,
        kind,
        payerId,
        ownerId: isPersonal ? context.selfId : null,
      });
    } else {
      const parsed = parseSplits(rawSplits, nameToId);
      if (!parsed.ok) return error(parsed.message);
      splits = parsed.splits;
    }

    if (splits.some((s) => !memberIds.includes(s.userId))) {
      return error('負担の相手がその共有範囲のメンバーではありません');
    }
    const total = splits.reduce((sum, s) => sum + s.amount, 0);
    if (total !== amount) return error(`負担の合計 ${total} が金額 ${amount} と一致しません`);

    const memo = row['備考'] ?? '';
    const payload: ImportPayload = {
      categoryId,
      newCategory,
      occurredOn,
      amount,
      payerId,
      memo,
      splits,
    };

    // 重複の判定は按分を適用した後の値で行う（列4）。
    // 生値で比べると、負担が空欄の行は決して一致せず二重登録になる
    const duplicated = context.existing.some(
      (e) =>
        e.occurredOn === occurredOn &&
        e.categoryId === categoryId &&
        e.amount === amount &&
        e.payerId === payerId &&
        e.memo === memo &&
        sameSplits(e.splits, splits),
    );
    if (duplicated && context.duplicates === 'skip') {
      entries.push({ line, status: 'skip', message: '同じ内容の取引がすでにあります' });
      return;
    }

    entries.push({ line, status: 'ok', payload });
  });

  return {
    entries,
    counts: {
      ok: entries.filter((e) => e.status === 'ok').length,
      skipped: entries.filter((e) => e.status === 'skip').length,
      error: entries.filter((e) => e.status === 'error').length,
    },
  };
}
