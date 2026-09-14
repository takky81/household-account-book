/** 取引一覧（§6）。対象月の絞り込み・編集・削除・まとめての付け替え。 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Button,
  Card,
  ConfirmDialog,
  ErrorText,
  Field,
  ScopeTag,
  Select,
  Tabs,
  TextInput,
} from '../../components/ui';
import { MonthNav } from '../app/Layout';
import { currentMonthKey, formatDay, monthEnd, monthStart } from '../../lib/date';
import { formatAmount } from '../../lib/money';
import { useNarrow } from '../../lib/useNarrow';
import {
  deleteTransaction,
  loadMonthTransactions,
  moveTransactions,
  moveTransactionsScope,
  type Transaction,
} from '../../lib/db';
import { useAuth, useWorkspace } from '../app/context';
import { selectableCategories } from '../categories/tree';
import { checkMove } from '../scope/move';
import { toMoveTx } from '../app/model';
import {
  activeFilterCount,
  emptyTransactionFilters,
  matchesTransaction,
  SHARED_PAYER_FILTER,
  type TransactionFilters,
} from './filter';

type ScopeFilterValue = 'all' | 'own' | string;

function FilterFields({
  value,
  onChange,
  monthKey,
  categories,
  profiles,
  categoryPath,
}: {
  value: TransactionFilters;
  onChange: (value: TransactionFilters) => void;
  monthKey: string;
  categories: { id: string }[];
  profiles: { id: string; display_name: string }[];
  categoryPath: (id: string) => string;
}) {
  const set = (part: Partial<TransactionFilters>) => onChange({ ...value, ...part });
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <div className="grid grid-cols-2 gap-2 sm:col-span-2">
        <Field label="開始日">
          <TextInput
            type="date"
            min={monthStart(monthKey)}
            max={monthEnd(monthKey)}
            value={value.dateFrom}
            onChange={(e) => set({ dateFrom: e.target.value })}
          />
        </Field>
        <Field label="終了日">
          <TextInput
            type="date"
            min={monthStart(monthKey)}
            max={monthEnd(monthKey)}
            value={value.dateTo}
            onChange={(e) => set({ dateTo: e.target.value })}
          />
        </Field>
      </div>
      <Field label="カテゴリ">
        <Select
          value={value.categoryId}
          onChange={(e) => set({ categoryId: e.target.value })}
        >
          <option value="">すべて</option>
          {[...categories]
            .sort((a, b) => categoryPath(a.id).localeCompare(categoryPath(b.id), 'ja'))
            .map((category) => (
              <option key={category.id} value={category.id}>
                {categoryPath(category.id)}
              </option>
            ))}
        </Select>
      </Field>
      <Field label="支払者">
        <Select value={value.payerId} onChange={(e) => set({ payerId: e.target.value })}>
          <option value="">すべて</option>
          <option value={SHARED_PAYER_FILTER}>共用</option>
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.display_name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-2 sm:col-span-2">
        <Field label="金額（下限）">
          <TextInput
            type="number"
            min="0"
            inputMode="numeric"
            placeholder="0"
            value={value.amountMin}
            onChange={(e) => set({ amountMin: e.target.value })}
          />
        </Field>
        <Field label="金額（上限）">
          <TextInput
            type="number"
            min="0"
            inputMode="numeric"
            placeholder="上限なし"
            value={value.amountMax}
            onChange={(e) => set({ amountMax: e.target.value })}
          />
        </Field>
      </div>
    </div>
  );
}

export function TransactionsPage() {
  const workspace = useWorkspace();
  const narrow = useNarrow();
  const { userId } = useAuth();
  const selfId = userId!;
  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const [rows, setRows] = useState<Transaction[]>([]);
  const [scope, setScope] = useState<ScopeFilterValue>('all');
  const [keyword, setKeyword] = useState('');
  const [filters, setFilters] = useState<TransactionFilters>(emptyTransactionFilters);
  const [draftFilters, setDraftFilters] = useState<TransactionFilters>(emptyTransactionFilters);
  const [filterOpen, setFilterOpen] = useState(false);
  const [desktopFilterOpen, setDesktopFilterOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [destCategoryId, setDestCategoryId] = useState('');
  /** まとめて付け替える先の共有範囲（§2.8） */
  const [destScopeKey, setDestScopeKey] = useState('');
  /** 削除を押した取引。確認ダイアログの「削除する」で初めて消す */
  const [pendingRemove, setPendingRemove] = useState<Transaction | null>(null);
  const [error, setError] = useState('');

  const reload = useMemo(
    () => async () => setRows(await loadMonthTransactions(monthKey)),
    [monthKey],
  );
  useEffect(() => {
    void reload();
  }, [reload]);

  // 共有範囲は取引が持つ（§2.4）。カテゴリからは決まらない
  const visible = rows.filter((tx) => {
    const category = workspace.categories.find((c) => c.id === tx.category_id);
    if (category === undefined) return false;
    if (scope === 'own' && tx.share_group_id !== null) return false;
    if (scope !== 'all' && scope !== 'own' && tx.share_group_id !== scope) return false;
    return matchesTransaction(tx, {
      keyword,
      filters,
      categoryPath: workspace.categoryPath,
      payerName: workspace.displayName,
    });
  });

  const filterCount = activeFilterCount(filters);

  function changeMonth(next: string) {
    setMonthKey(next);
    setFilters(emptyTransactionFilters);
    setDraftFilters(emptyTransactionFilters);
    setFilterOpen(false);
  }

  function openFilters() {
    setDraftFilters(filters);
    setFilterOpen(true);
  }

  function clearFilters() {
    setFilters(emptyTransactionFilters);
    setDraftFilters(emptyTransactionFilters);
  }

  const categoryOf = (tx: Transaction) =>
    workspace.categories.find((c) => c.id === tx.category_id)!;

  function toggle(id: string, checked: boolean) {
    setSelected(checked ? [...selected, id] : selected.filter((x) => x !== id));
  }

  async function remove(tx: Transaction) {
    setPendingRemove(null);
    await deleteTransaction(tx.id);
    await reload();
  }

  /**
   * カテゴリの付け替え。共有範囲は動かないので負担は保たれ、§5.2 の検査も要らない（§2.8）。
   */
  async function move() {
    setError('');
    if (destCategoryId === '' || selected.length === 0) return;
    try {
      await moveTransactions(selected, destCategoryId);
      setSelected([]);
      await reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '付け替えられませんでした');
    }
  }

  /**
   * 共有範囲の付け替え。範囲が変わる取引は負担が作り直されるので、
   * 先に §5.2 の検査を画面でも行って件数と理由を出す。
   */
  async function moveScope() {
    setError('');
    const dest = workspace.scopes.find((s) => s.key === destScopeKey);
    if (dest === undefined || selected.length === 0) return;
    const picked = rows.filter((tx) => selected.includes(tx.id));
    const source = picked[0];
    const check = checkMove({
      source: {
        shareGroupId: source?.share_group_id ?? null,
        ownerId: source?.owner_id ?? null,
      },
      dest,
      transactions: toMoveTx(picked),
      destMemberIds:
        dest.shareGroupId === null
          ? [selfId]
          : workspace.membersOf(dest.shareGroupId).map((m) => m.userId),
      selfId,
      myGroupIds: workspace.myGroupIds,
    });
    if (!check.ok) {
      setError(check.message);
      return;
    }
    try {
      await moveTransactionsScope({
        ids: selected,
        destShareGroupId: dest.shareGroupId,
        destOwnerId: dest.ownerId,
      });
      setSelected([]);
      await reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '付け替えられませんでした');
    }
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-3 p-3">
      <h1 className="text-lg font-bold">取引一覧</h1>
      <MonthNav monthKey={monthKey} onChange={changeMonth} />

      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          label="対象範囲"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'all', label: 'すべて' },
            ...workspace.groups.map((g) => ({ value: g.id, label: g.name })),
            { value: 'own', label: '個人' },
          ]}
        />
        <TextInput
          aria-label="キーワードで絞る"
          placeholder="カテゴリ・備考・支払者で検索"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          className="min-w-0 flex-1"
        />
        {narrow && (
          <Button variant="ghost" onClick={openFilters} aria-expanded={filterOpen}>
            絞り込み{filterCount > 0 ? ` (${filterCount})` : ''}
          </Button>
        )}
        {!narrow && (
          <Button
            variant="ghost"
            onClick={() => setDesktopFilterOpen((open) => !open)}
            aria-expanded={desktopFilterOpen}
            aria-controls="desktop-transaction-filters"
          >
            絞り込み{filterCount > 0 ? ` (${filterCount})` : ''}{' '}
            {desktopFilterOpen ? '▲' : '▼'}
          </Button>
        )}
      </div>

      {!narrow && desktopFilterOpen && (
        <div id="desktop-transaction-filters">
          <Card className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold">絞り込み条件</h2>
              <div className="flex gap-2">
                {filterCount > 0 && (
                  <Button variant="ghost" onClick={clearFilters}>
                    すべて解除
                  </Button>
                )}
                <Button variant="ghost" onClick={() => setDesktopFilterOpen(false)}>
                  閉じる
                </Button>
              </div>
            </div>
            <FilterFields
              value={filters}
              onChange={setFilters}
              monthKey={monthKey}
              categories={workspace.categories}
              profiles={workspace.profiles}
              categoryPath={workspace.categoryPath}
            />
          </Card>
        </div>
      )}

      {narrow && filterCount > 0 && (
        <div className="flex flex-wrap gap-1" aria-label="適用中の絞り込み条件">
          {(filters.dateFrom !== '' || filters.dateTo !== '') && (
            <button
              type="button"
              className="rounded-full border border-[var(--c-edge)] bg-[var(--c-panel)] px-2 py-1 text-xs"
              onClick={() => setFilters({ ...filters, dateFrom: '', dateTo: '' })}
            >
              {filters.dateFrom || '月初'}～{filters.dateTo || '月末'} ×
            </button>
          )}
          {filters.categoryId !== '' && (
            <button
              type="button"
              className="rounded-full border border-[var(--c-edge)] bg-[var(--c-panel)] px-2 py-1 text-xs"
              onClick={() => setFilters({ ...filters, categoryId: '' })}
            >
              {workspace.categoryPath(filters.categoryId)} ×
            </button>
          )}
          {filters.payerId !== '' && (
            <button
              type="button"
              className="rounded-full border border-[var(--c-edge)] bg-[var(--c-panel)] px-2 py-1 text-xs"
              onClick={() => setFilters({ ...filters, payerId: '' })}
            >
              {filters.payerId === SHARED_PAYER_FILTER
                ? '共用'
                : workspace.displayName(filters.payerId)}{' '}
              ×
            </button>
          )}
          {(filters.amountMin !== '' || filters.amountMax !== '') && (
            <button
              type="button"
              className="rounded-full border border-[var(--c-edge)] bg-[var(--c-panel)] px-2 py-1 text-xs"
              onClick={() => setFilters({ ...filters, amountMin: '', amountMax: '' })}
            >
              {filters.amountMin || '0'}～{filters.amountMax || '上限なし'}円 ×
            </button>
          )}
          <button
            type="button"
            className="px-2 py-1 text-xs text-[var(--c-link)]"
            onClick={clearFilters}
          >
            すべて解除
          </button>
        </div>
      )}

      {narrow && filterOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-[var(--c-overlay)]"
          onClick={() => setFilterOpen(false)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="transaction-filter-title"
            className="flex max-h-[90vh] w-full flex-col gap-3 overflow-y-auto rounded-t-2xl border border-[var(--c-line)] bg-[var(--c-panel)] p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 id="transaction-filter-title" className="font-bold">
                絞り込み条件
              </h2>
              <button
                type="button"
                className="px-2 text-xl"
                aria-label="絞り込み条件を閉じる"
                onClick={() => setFilterOpen(false)}
              >
                ×
              </button>
            </div>
            <FilterFields
              value={draftFilters}
              onChange={setDraftFilters}
              monthKey={monthKey}
              categories={workspace.categories}
              profiles={workspace.profiles}
              categoryPath={workspace.categoryPath}
            />
            <div className="sticky bottom-0 flex justify-between gap-2 bg-[var(--c-panel)] pt-2">
              <Button variant="ghost" onClick={() => setDraftFilters(emptyTransactionFilters)}>
                条件をすべて解除
              </Button>
              <Button
                onClick={() => {
                  setFilters(draftFilters);
                  setFilterOpen(false);
                }}
              >
                この条件で表示
              </Button>
            </div>
          </section>
        </div>
      )}

      {/* 狭い画面では8列が横に入りきらないので、1取引=1枚のカードに積む（Layout と同じ境目）。 */}
      {narrow ? (
        <ul className="flex flex-col gap-2" data-testid="tx-cards">
          {visible.map((tx) => {
            const category = categoryOf(tx);
            return (
              <li key={tx.id}>
                <Card className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      aria-label={`${category.name} を選ぶ`}
                      checked={selected.includes(tx.id)}
                      onChange={(e) => toggle(tx.id, e.target.checked)}
                    />
                    <span className="text-sm whitespace-nowrap">{formatDay(tx.occurred_on)}</span>
                    <ScopeTag
                      label={workspace.scopeLabel(tx)}
                      kind={tx.share_group_id === null ? 'own' : 'group'}
                    />
                    <span className="ml-auto text-base font-bold tabular-nums">
                      {formatAmount(tx.amount)}
                    </span>
                  </div>
                  <div className="text-sm">
                    {workspace.categoryPath(category.id)}
                    <span className="text-[var(--c-ink-soft)]">
                      {' / '}
                      {workspace.displayName(tx.payer_id)}
                    </span>
                  </div>
                  {tx.memo !== '' && (
                    <p className="text-xs break-words text-[var(--c-muted)]">{tx.memo}</p>
                  )}
                  <div className="flex justify-end gap-3 text-sm">
                    <Link className="text-[var(--c-link)]" to={`/transactions/${tx.id}/edit`}>
                      編集
                    </Link>
                    <button
                      type="button"
                      className="text-[var(--c-warn)]"
                      onClick={() => setPendingRemove(tx)}
                    >
                      削除
                    </button>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm" data-testid="tx-table">
            <thead>
              <tr className="bg-[var(--c-subtle)] text-left text-xs text-[var(--c-ink-soft)]">
                <th className="p-2"></th>
                <th className="p-2">日付</th>
                <th className="p-2">共有範囲</th>
                <th className="p-2">カテゴリ</th>
                <th className="p-2">支払者</th>
                <th className="p-2 text-right">金額</th>
                <th className="p-2">備考</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((tx) => {
                const category = categoryOf(tx);
                return (
                  <tr key={tx.id} className="border-t border-[var(--c-line)]">
                    <td className="p-2">
                      <input
                        type="checkbox"
                        aria-label={`${category.name} を選ぶ`}
                        checked={selected.includes(tx.id)}
                        onChange={(e) => toggle(tx.id, e.target.checked)}
                      />
                    </td>
                    <td className="p-2 whitespace-nowrap">{formatDay(tx.occurred_on)}</td>
                    <td className="p-2">
                      <ScopeTag
                        label={workspace.scopeLabel(tx)}
                        kind={tx.share_group_id === null ? 'own' : 'group'}
                      />
                    </td>
                    <td className="p-2">{workspace.categoryPath(category.id)}</td>
                    <td className="p-2">{workspace.displayName(tx.payer_id)}</td>
                    <td className="p-2 text-right tabular-nums">{formatAmount(tx.amount)}</td>
                    <td className="p-2">{tx.memo}</td>
                    <td className="p-2 whitespace-nowrap">
                      <Link className="text-[var(--c-link)]" to={`/transactions/${tx.id}/edit`}>
                        編集
                      </Link>
                      <button
                        type="button"
                        className="ml-2 text-[var(--c-warn)]"
                        onClick={() => setPendingRemove(tx)}
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {visible.length === 0 && <p className="text-xs text-[var(--c-muted)]">取引がありません</p>}

      {selected.length > 0 && (
        <Card className="flex flex-wrap items-center gap-2">
          <span className="text-sm">{selected.length}件を選択中</span>
          <select
            aria-label="付け替え先のカテゴリ"
            className="rounded-md border border-[var(--c-edge)] bg-[var(--c-panel)] px-2 py-1 text-sm"
            value={destCategoryId}
            onChange={(e) => setDestCategoryId(e.target.value)}
          >
            <option value="">選んでください</option>
            {selectableCategories(workspace.tree).map((c) => (
              <option key={c.id} value={c.id}>
                {workspace.categoryPath(c.id)}
              </option>
            ))}
          </select>
          <Button onClick={() => void move()}>カテゴリを付け替える</Button>

          <select
            aria-label="付け替え先の共有範囲"
            className="rounded-md border border-[var(--c-edge)] bg-[var(--c-panel)] px-2 py-1 text-sm"
            value={destScopeKey}
            onChange={(e) => setDestScopeKey(e.target.value)}
          >
            <option value="">選んでください</option>
            {workspace.scopes.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <Button onClick={() => void moveScope()}>共有範囲を付け替える</Button>
        </Card>
      )}

      <ErrorText>{error}</ErrorText>

      {pendingRemove !== null && (
        <ConfirmDialog
          title="この取引を削除しますか"
          detail={[
            `${formatDay(pendingRemove.occurred_on)} ${workspace.categoryPath(
              pendingRemove.category_id,
            )} ${formatAmount(pendingRemove.amount)}`,
            '負担もまとめて消え、元に戻せません',
          ]}
          confirmLabel="削除する"
          onConfirm={() => void remove(pendingRemove)}
          onCancel={() => setPendingRemove(null)}
        />
      )}
    </main>
  );
}
