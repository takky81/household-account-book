import type { Transaction } from '../../lib/db';

export type TransactionFilters = {
  dateFrom: string;
  dateTo: string;
  categoryId: string;
  tagId: string;
  payerId: string;
  amountMin: string;
  amountMax: string;
};

export const emptyTransactionFilters: TransactionFilters = {
  dateFrom: '',
  dateTo: '',
  categoryId: '',
  tagId: '',
  payerId: '',
  amountMin: '',
  amountMax: '',
};

export const SHARED_PAYER_FILTER = '__shared__';

type FilterContext = {
  keyword: string;
  filters: TransactionFilters;
  categoryPath: (id: string) => string;
  payerName: (id: string | null) => string;
  tagName: (id: string) => string;
};

/** 表記揺れを少し吸収して、一覧に表示している文字から取引を探す。 */
function searchable(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('ja-JP');
}

function optionalNumber(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function matchesTransaction(tx: Transaction, context: FilterContext): boolean {
  const { filters } = context;
  const keyword = searchable(context.keyword.trim());
  if (
    keyword !== '' &&
    !searchable(
      `${context.categoryPath(tx.category_id)} ${tx.memo} ${context.payerName(tx.payer_id)} ${tx.transaction_tags.map((tag) => context.tagName(tag.tag_id)).join(' ')}`,
    ).includes(keyword)
  ) {
    return false;
  }
  if (filters.dateFrom !== '' && tx.occurred_on < filters.dateFrom) return false;
  if (filters.dateTo !== '' && tx.occurred_on > filters.dateTo) return false;
  if (filters.categoryId !== '' && tx.category_id !== filters.categoryId) return false;
  if (filters.tagId !== '' && !tx.transaction_tags.some((tag) => tag.tag_id === filters.tagId)) return false;
  if (
    filters.payerId !== '' &&
    (filters.payerId === SHARED_PAYER_FILTER
      ? tx.payer_id !== null
      : tx.payer_id !== filters.payerId)
  ) {
    return false;
  }
  const amountMin = optionalNumber(filters.amountMin);
  const amountMax = optionalNumber(filters.amountMax);
  if (amountMin !== null && tx.amount < amountMin) return false;
  if (amountMax !== null && tx.amount > amountMax) return false;
  return true;
}

/** 日付範囲と金額範囲は、それぞれ1つの条件として数える。 */
export function activeFilterCount(filters: TransactionFilters): number {
  return (
    Number(filters.dateFrom !== '' || filters.dateTo !== '') +
    Number(filters.categoryId !== '') +
    Number(filters.tagId !== '') +
    Number(filters.payerId !== '') +
    Number(filters.amountMin !== '' || filters.amountMax !== '')
  );
}
