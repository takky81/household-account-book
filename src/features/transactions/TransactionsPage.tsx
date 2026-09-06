/** 取引一覧（§6）。対象月の絞り込み・編集・削除・まとめての付け替え。 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, ErrorText, ScopeTag, Tabs, TextInput } from '../../components/ui';
import { MonthNav } from '../app/Layout';
import { currentMonthKey, formatDay } from '../../lib/date';
import { formatAmount } from '../../lib/money';
import { useNarrow } from '../../lib/useNarrow';
import {
  deleteTransaction,
  loadMonthTransactions,
  moveTransactions,
  type Transaction,
} from '../../lib/db';
import { useAuth, useWorkspace } from '../app/context';
import { checkMove } from '../scope/move';
import { toCategoryLike, toMoveTx } from '../app/model';

type ScopeFilterValue = 'all' | 'own' | string;

export function TransactionsPage() {
  const workspace = useWorkspace();
  const narrow = useNarrow();
  const { userId } = useAuth();
  const selfId = userId!;
  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const [rows, setRows] = useState<Transaction[]>([]);
  const [scope, setScope] = useState<ScopeFilterValue>('all');
  const [keyword, setKeyword] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [destCategoryId, setDestCategoryId] = useState('');
  const [error, setError] = useState('');

  const reload = useMemo(
    () => async () => setRows(await loadMonthTransactions(monthKey)),
    [monthKey],
  );
  useEffect(() => {
    void reload();
  }, [reload]);

  const visible = rows.filter((tx) => {
    const category = workspace.categories.find((c) => c.id === tx.category_id);
    if (category === undefined) return false;
    if (scope === 'own' && category.share_group_id !== null) return false;
    if (scope !== 'all' && scope !== 'own' && category.share_group_id !== scope) return false;
    if (keyword !== '' && !`${category.name}${tx.memo}`.includes(keyword)) return false;
    return true;
  });

  const categoryOf = (tx: Transaction) =>
    workspace.categories.find((c) => c.id === tx.category_id)!;

  function toggle(id: string, checked: boolean) {
    setSelected(checked ? [...selected, id] : selected.filter((x) => x !== id));
  }

  async function remove(id: string) {
    await deleteTransaction(id);
    await reload();
  }

  async function move() {
    setError('');
    const dest = workspace.categories.find((c) => c.id === destCategoryId);
    if (dest === undefined || selected.length === 0) return;
    const picked = rows.filter((tx) => selected.includes(tx.id));
    const source = picked[0];
    const sourceCategory =
      source === undefined ? null : workspace.categories.find((c) => c.id === source.category_id);
    const check = checkMove({
      source: {
        shareGroupId: sourceCategory?.share_group_id ?? null,
        ownerId: sourceCategory?.owner_id ?? null,
      },
      dest: { shareGroupId: dest.share_group_id, ownerId: dest.owner_id },
      kind: dest.kind,
      name: dest.name,
      categories: workspace.categories.map(toCategoryLike),
      transactions: toMoveTx(picked),
      destMemberIds:
        dest.share_group_id === null
          ? [selfId]
          : workspace.membersOf(dest.share_group_id).map((m) => m.userId),
      selfId,
      myGroupIds: workspace.myGroupIds,
      sourceCategoryId: sourceCategory?.id ?? '',
      // 移動先は既存のカテゴリそのものなので、同名の検査はしない（§2.8）
      skipNameCheck: true,
    });
    if (!check.ok) {
      setError(check.message);
      return;
    }
    try {
      await moveTransactions(selected, destCategoryId);
      setSelected([]);
      await reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '付け替えられませんでした');
    }
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-3 p-3">
      <h1 className="text-lg font-bold">取引一覧</h1>
      <MonthNav monthKey={monthKey} onChange={setMonthKey} />

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
          placeholder="キーワードで絞る"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
      </div>

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
                      label={workspace.scopeLabel(category)}
                      kind={category.share_group_id === null ? 'own' : 'group'}
                    />
                    <span className="ml-auto text-base font-bold tabular-nums">
                      {formatAmount(tx.amount)}
                    </span>
                  </div>
                  <div className="text-sm">
                    {category.name}
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
                      onClick={() => void remove(tx.id)}
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
                        label={workspace.scopeLabel(category)}
                        kind={category.share_group_id === null ? 'own' : 'group'}
                      />
                    </td>
                    <td className="p-2">{category.name}</td>
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
                        onClick={() => void remove(tx.id)}
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
            {workspace.categories
              .filter((c) => !c.is_archived)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {workspace.scopeLabel(c)} / {c.name}
                </option>
              ))}
          </select>
          <Button onClick={() => void move()}>カテゴリを付け替える</Button>
        </Card>
      )}

      <ErrorText>{error}</ErrorText>
    </main>
  );
}
