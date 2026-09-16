import { describe, expect, it } from 'vitest';
import type { Transaction } from '../../lib/db';
import {
  activeFilterCount,
  emptyTransactionFilters,
  matchesTransaction,
  SHARED_PAYER_FILTER,
  type TransactionFilters,
} from './filter';

const tx: Transaction = {
  id: 't1',
  category_id: 'food',
  payer_id: 'u1',
  created_by: 'u1',
  occurred_on: '2026-09-14',
  amount: 1200,
  memo: '駅前スーパー',
  share_group_id: null,
  owner_id: 'u1',
  splits_are_manual: false,
  transaction_splits: [],
  transaction_tags: [],
};

function matches(keyword: string, filters: Partial<TransactionFilters> = {}, target = tx) {
  return matchesTransaction(target, {
    keyword,
    filters: { ...emptyTransactionFilters, ...filters },
    categoryPath: () => '食費 / 食料品',
    payerName: (id) => (id === null ? '共用' : 'たかし'),
    tagName: () => '',
  });
}

describe('取引一覧の絞り込み', () => {
  it('カテゴリ階層名・備考・支払者名をキーワードで探せる', () => {
    expect(matches('食費')).toBe(true);
    expect(matches('スーパー')).toBe(true);
    expect(matches('たかし')).toBe(true);
    expect(matches('はなこ')).toBe(false);
  });

  it('列20 タグ名の検索とタグ条件で絞れる', () => {
    const tagged = { ...tx, transaction_tags: [{ tag_id: 'travel' }] };
    expect(matchesTransaction(tagged, {
      keyword: '旅行',
      filters: emptyTransactionFilters,
      categoryPath: () => '交通費',
      payerName: () => 'たかし',
      tagName: (id) => id === 'travel' ? '旅行' : '',
    })).toBe(true);
    expect(matches('', { tagId: 'travel' }, tagged)).toBe(true);
    expect(matches('', { tagId: 'home' }, tagged)).toBe(false);
  });

  it('開始日と終了日を含む範囲で絞る', () => {
    expect(matches('', { dateFrom: '2026-09-14', dateTo: '2026-09-14' })).toBe(true);
    expect(matches('', { dateFrom: '2026-09-15' })).toBe(false);
    expect(matches('', { dateTo: '2026-09-13' })).toBe(false);
  });

  it('カテゴリ、支払者、金額の条件を組み合わせる', () => {
    expect(
      matches('', { categoryId: 'food', payerId: 'u1', amountMin: '1000', amountMax: '1500' }),
    ).toBe(true);
    expect(matches('', { categoryId: 'travel' })).toBe(false);
    expect(matches('', { amountMax: '1199' })).toBe(false);
  });

  it('共用の支払者を絞れる', () => {
    expect(matches('', { payerId: SHARED_PAYER_FILTER })).toBe(false);
    expect(matches('', { payerId: SHARED_PAYER_FILTER }, { ...tx, payer_id: null })).toBe(true);
  });

  it('条件の種類数を数える', () => {
    expect(
      activeFilterCount({
        ...emptyTransactionFilters,
        dateFrom: '2026-09-01',
        dateTo: '2026-09-14',
        categoryId: 'food',
        amountMin: '500',
      }),
    ).toBe(3);
  });
});
