/** カテゴリ管理（決定表「カテゴリの管理」「共有範囲の変更」）。 */

import { useState } from 'react';
import { Button, Card, ErrorText, Field, Note, ScopeTag, Select, Tabs, TextInput } from '../../components/ui';
import {
  createCategory,
  deleteCategory,
  loadTransactions,
  moveCategoryScope,
  updateCategory,
  type Category,
} from '../../lib/db';
import { useAuth, useWorkspace, groupByScope } from '../app/context';
import { findNameConflict, normalizeCategoryName, validateCategoryName, type Kind } from './name';
import { nextSortOrder, reorder } from './order';
import { checkMove, manualCount } from '../scope/move';
import { toCategoryLike, toMoveTx } from '../app/model';

const OWN = '__own__';

export function CategoriesPage() {
  const workspace = useWorkspace();
  const { userId } = useAuth();
  const selfId = userId!;
  const [kind, setKind] = useState<Kind>('expense');
  const [name, setName] = useState('');
  const [scope, setScope] = useState<string>(OWN);
  const [error, setError] = useState('');
  const [moveTarget, setMoveTarget] = useState<{ id: string; dest: string } | null>(null);
  const [confirm, setConfirm] = useState<{ message: string; merge: boolean } | null>(null);

  /** 名前を変える。同じ共有範囲の同名は保存する前に弾く（列3） */
  async function rename(categoryId: string, raw: string) {
    setError('');
    const category = workspace.categories.find((c) => c.id === categoryId);
    if (category === undefined || normalizeCategoryName(raw) === category.name) return;
    const check = validateCategoryName(raw);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    const conflict = findNameConflict(
      workspace.categories.map(toCategoryLike),
      {
        shareGroupId: category.share_group_id,
        ownerId: category.owner_id,
        kind: category.kind,
        name: raw,
      },
      categoryId,
    );
    if (conflict !== null) {
      setError('同じ共有範囲に同じ名前のカテゴリがあります');
      return;
    }
    try {
      await updateCategory(categoryId, { name: normalizeCategoryName(raw) });
      await workspace.reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '変えられませんでした');
    }
  }

  const scoped = groupByScope(workspace.categories.filter((c) => c.kind === kind));

  async function add() {
    setError('');
    const check = validateCategoryName(name);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    const shareGroupId = scope === OWN ? null : scope;
    const conflict = findNameConflict(workspace.categories.map(toCategoryLike), {
      shareGroupId,
      ownerId: shareGroupId === null ? selfId : null,
      kind,
      name,
    });
    if (conflict !== null) {
      setError('同じ共有範囲に同じ名前のカテゴリがあります');
      return;
    }
    const siblings = workspace.categories.filter(
      (c) =>
        !c.is_system &&
        c.kind === kind &&
        c.share_group_id === shareGroupId &&
        c.owner_id === (shareGroupId === null ? selfId : null),
    );
    try {
      await createCategory({
        shareGroupId,
        kind,
        name: normalizeCategoryName(name),
        color: '#4a6fa5',
        sortOrder: nextSortOrder(siblings.map((c) => ({ id: c.id, sortOrder: c.sort_order }))),
      });
      setName('');
      await workspace.reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '作れませんでした');
    }
  }

  /** 同じ共有範囲の中で1つ上（下）へ動かす（列14） */
  async function move(categoryId: string, siblings: Category[], direction: 'up' | 'down') {
    setError('');
    const changed = reorder(
      siblings.map((c) => ({ id: c.id, sortOrder: c.sort_order })),
      categoryId,
      direction,
    );
    if (changed.length === 0) return;
    try {
      for (const item of changed) {
        await updateCategory(item.id, { sort_order: item.sortOrder });
      }
      await workspace.reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '並べ替えられませんでした');
    }
  }

  async function startMove(categoryId: string, dest: string, merge: boolean) {
    setError('');
    setConfirm(null);
    const category = workspace.categories.find((c) => c.id === categoryId);
    if (category === undefined) return;
    const destShareGroupId = dest === OWN ? null : dest;
    const destOwnerId = destShareGroupId === null ? selfId : null;

    const transactions = (await loadTransactions({})).filter((tx) => tx.category_id === categoryId);
    const check = checkMove({
      source: { shareGroupId: category.share_group_id, ownerId: category.owner_id },
      dest: { shareGroupId: destShareGroupId, ownerId: destOwnerId },
      kind: category.kind,
      name: category.name,
      categories: workspace.categories.map(toCategoryLike),
      transactions: toMoveTx(transactions),
      destMemberIds:
        destShareGroupId === null
          ? [selfId]
          : workspace.membersOf(destShareGroupId).map((m) => m.userId),
      selfId,
      myGroupIds: workspace.myGroupIds,
      sourceCategoryId: categoryId,
    });

    if (!check.ok && check.reason === 'name-conflict' && !merge) {
      setConfirm({ message: `${check.message} 統合しますか？`, merge: true });
      setMoveTarget({ id: categoryId, dest });
      return;
    }
    if (!check.ok && check.reason !== 'name-conflict') {
      setError(check.message);
      return;
    }

    const manual = manualCount(toMoveTx(transactions));
    if (manual > 0 && confirm === null && !merge) {
      setConfirm({
        message: `手で直した負担が ${manual} 件あります。既定の割合で作り直します。よろしいですか？`,
        merge: false,
      });
      setMoveTarget({ id: categoryId, dest });
      return;
    }

    try {
      await moveCategoryScope({
        categoryId,
        destShareGroupId,
        destOwnerId,
        merge,
      });
      setMoveTarget(null);
      setConfirm(null);
      await workspace.reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '移せませんでした');
    }
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-3 p-3">
      <h1 className="text-lg font-bold">カテゴリ</h1>

      <Tabs
        label="収支"
        value={kind}
        onChange={setKind}
        options={[
          { value: 'expense', label: '支出' },
          { value: 'income', label: '収入' },
        ]}
      />

      <Card className="flex flex-col gap-2">
        <h2 className="text-sm font-bold">カテゴリを追加</h2>
        <Field label="共有範囲">
          <Select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="共有範囲">
            <option value={OWN}>個人</option>
            {workspace.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="名前">
          <TextInput aria-label="カテゴリ名" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Button onClick={() => void add()}>追加</Button>
      </Card>

      <ErrorText>{error}</ErrorText>

      {confirm !== null && moveTarget !== null && (
        <Card className="flex flex-col gap-2">
          <p className="text-sm" role="alert">
            {confirm.message}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              やめる
            </Button>
            <Button onClick={() => void startMove(moveTarget.id, moveTarget.dest, confirm.merge)}>
              {confirm.merge ? '統合して移す' : '移す'}
            </Button>
          </div>
        </Card>
      )}

      {scoped.map((group) => {
        // 未分類は常に末尾（sort_order 9999）なので並べ替えの対象から外す
        const movable = group.items.filter((c) => !c.is_system);
        return (
          <Card key={group.key} className="flex flex-col gap-2">
            <ScopeTag
              label={workspace.scopeLabel({ share_group_id: group.shareGroupId })}
              kind={group.shareGroupId === null ? 'own' : 'group'}
            />
            {group.items.map((category) => {
              const index = movable.findIndex((c) => c.id === category.id);
              return (
                <div
                  key={category.id}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <span className="flex items-center gap-2 text-sm">
                    {!category.is_system && (
                      <span className="flex flex-col leading-none">
                        <button
                          type="button"
                          aria-label={`${category.name}を上へ`}
                          className="px-1 text-xs disabled:opacity-30"
                          disabled={index === 0}
                          onClick={() => void move(category.id, movable, 'up')}
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          aria-label={`${category.name}を下へ`}
                          className="px-1 text-xs disabled:opacity-30"
                          disabled={index === movable.length - 1}
                          onClick={() => void move(category.id, movable, 'down')}
                        >
                          ▼
                        </button>
                      </span>
                    )}
                    {category.is_system ? (
                      category.name
                    ) : (
                      <TextInput
                        aria-label={`${category.name}の名前`}
                        className="w-28"
                        defaultValue={category.name}
                        key={category.name}
                        onBlur={(e) => void rename(category.id, e.target.value)}
                      />
                    )}
                    {!category.is_system && (
                      <input
                        type="color"
                        aria-label={`${category.name}の色`}
                        className="h-6 w-8 rounded border border-[var(--c-edge)]"
                        defaultValue={category.color}
                        key={`${category.id}-color`}
                        onBlur={async (e) => {
                          if (e.target.value === category.color) return;
                          await updateCategory(category.id, { color: e.target.value });
                          await workspace.reload();
                        }}
                      />
                    )}
                    {category.is_archived && (
                      <span className="ml-1 text-xs text-[var(--c-muted)]">アーカイブ済み</span>
                    )}
                    {category.is_system && (
                      <span className="ml-1 text-xs text-[var(--c-muted)]">（消せない）</span>
                    )}
                  </span>
                  {!category.is_system && (
                    <span className="flex items-center gap-2 text-xs">
                      <select
                        aria-label={`${category.name}の移動先`}
                        className="rounded border border-[var(--c-edge)] bg-[var(--c-panel)] px-1 py-0.5"
                        defaultValue=""
                        onChange={(e) => {
                          if (e.target.value !== '')
                            void startMove(category.id, e.target.value, false);
                        }}
                      >
                        <option value="">共有範囲を変える</option>
                        <option value={OWN}>個人へ</option>
                        {workspace.groups.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}へ
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={async () => {
                          await updateCategory(category.id, { is_archived: !category.is_archived });
                          await workspace.reload();
                        }}
                      >
                        {category.is_archived ? '戻す' : 'アーカイブ'}
                      </button>
                      <button
                        type="button"
                        className="text-[var(--c-warn)]"
                        onClick={async () => {
                          setError('');
                          try {
                            await deleteCategory(category.id);
                            await workspace.reload();
                          } catch (failure) {
                            setError(
                              failure instanceof Error ? failure.message : '消せませんでした',
                            );
                          }
                        }}
                      >
                        削除
                      </button>
                    </span>
                  )}
                </div>
              );
            })}
          </Card>
        );
      })}

      <Note>
        削除すると、その取引は同じ共有範囲・同じ収支区分の未分類へ移る。未分類は消せない（§3.8）。
        ▲▼ で並べ替えると、入力や集計でもその順に出る
      </Note>
    </main>
  );
}
