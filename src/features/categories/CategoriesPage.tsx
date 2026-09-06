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
  type ShareGroup,
} from '../../lib/db';
import { useAuth, useWorkspace, groupByScope } from '../app/context';
import { findNameConflict, normalizeCategoryName, validateCategoryName, type Kind } from './name';
import { nextSortOrder, reorder } from './order';
import { canBeParent, childrenOf, orderedTree, siblingsOf } from './tree';
import { checkMove, manualCount } from '../scope/move';
import { toMoveTx, toTreeCategory } from '../app/model';

const OWN = '__own__';
/** 親を選ばない（大分類として作る） */
const ROOT = '';

/** 名前が衝突したときの知らせ方。大分類と小分類で見る範囲が違う（§3.4） */
function conflictMessage(parentId: string | null): string {
  return parentId === null
    ? '同じ共有範囲に同じ名前のカテゴリがあります'
    : '同じ大分類に同じ名前の小分類があります';
}

type RowActions = {
  rename: (categoryId: string, raw: string) => void;
  move: (category: Category, direction: 'up' | 'down') => void;
  remove: (categoryId: string) => void;
  update: (categoryId: string, patch: { color?: string; is_archived?: boolean }) => void;
  startMove: (categoryId: string, dest: string) => void;
};

/** 一覧の1行。小分類は親の下にぶら下げて見せる（§3.4.1） */
function CategoryRow({
  category,
  siblings,
  groups,
  actions,
}: {
  category: Category;
  siblings: Category[];
  groups: ShareGroup[];
  actions: RowActions;
}) {
  const index = siblings.findIndex((c) => c.id === category.id);
  const isChild = category.parent_id !== null;
  return (
    <div className={`flex items-center justify-between gap-2 ${isChild ? 'pl-4' : ''}`}>
      <span className="flex min-w-0 flex-1 items-center gap-1 text-sm">
        {isChild && (
          <span aria-hidden className="shrink-0 text-xs text-[var(--c-muted)]">
            └
          </span>
        )}
        {!category.is_system && (
          <span className="flex flex-col leading-none">
            <button
              type="button"
              aria-label={`${category.name}を上へ`}
              className="text-xs disabled:opacity-30"
              disabled={index <= 0}
              onClick={() => actions.move(category, 'up')}
            >
              ▲
            </button>
            <button
              type="button"
              aria-label={`${category.name}を下へ`}
              className="text-xs disabled:opacity-30"
              disabled={index === siblings.length - 1}
              onClick={() => actions.move(category, 'down')}
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
            className="w-full min-w-0"
            defaultValue={category.name}
            key={category.name}
            onBlur={(e) => actions.rename(category.id, e.target.value)}
          />
        )}
        {!category.is_system && (
          <input
            type="color"
            aria-label={`${category.name}の色`}
            className="h-6 w-8 shrink-0 rounded border border-[var(--c-edge)]"
            defaultValue={category.color}
            key={`${category.id}-color`}
            onBlur={(e) => {
              if (e.target.value !== category.color) {
                actions.update(category.id, { color: e.target.value });
              }
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
        <span className="flex shrink-0 items-center gap-1 text-xs">
          {/* 共有範囲の変更は大分類の単位。小分類には出さない（§5.2） */}
          {!isChild && (
            <select
              aria-label={`${category.name}の移動先`}
              className="rounded border border-[var(--c-edge)] bg-[var(--c-panel)] px-1 py-0.5"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value !== '') actions.startMove(category.id, e.target.value);
              }}
            >
              <option value="">共有範囲を変える</option>
              <option value={OWN}>個人へ</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}へ
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            aria-label={`${category.name}を${category.is_archived ? '戻す' : 'アーカイブ'}`}
            onClick={() => actions.update(category.id, { is_archived: !category.is_archived })}
          >
            {category.is_archived ? '戻す' : 'アーカイブ'}
          </button>
          <button
            type="button"
            aria-label={`${category.name}を削除`}
            className="text-[var(--c-warn)]"
            onClick={() => actions.remove(category.id)}
          >
            削除
          </button>
        </span>
      )}
    </div>
  );
}

export function CategoriesPage() {
  const workspace = useWorkspace();
  const { userId } = useAuth();
  const selfId = userId!;
  const [kind, setKind] = useState<Kind>('expense');
  const [name, setName] = useState('');
  const [scope, setScope] = useState<string>(OWN);
  const [parentId, setParentId] = useState<string>(ROOT);
  const [error, setError] = useState('');
  const [moveTarget, setMoveTarget] = useState<{ id: string; dest: string } | null>(null);
  const [confirm, setConfirm] = useState<{ message: string; merge: boolean } | null>(null);

  const shareGroupId = scope === OWN ? null : scope;
  const ownerId = shareGroupId === null ? selfId : null;

  /** 追加フォームで親に選べる大分類（未分類は親になれない。§3.4.1） */
  const parentOptions = workspace.tree.filter(
    (c) =>
      canBeParent(c) &&
      c.kind === kind &&
      c.shareGroupId === shareGroupId &&
      c.ownerId === ownerId,
  );

  /** 名前を変える。同じ共有範囲・同じ親の同名は保存する前に弾く（列3・列16） */
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
      workspace.tree,
      {
        shareGroupId: category.share_group_id,
        ownerId: category.owner_id,
        kind: category.kind,
        name: raw,
        parentId: category.parent_id,
      },
      categoryId,
    );
    if (conflict !== null) {
      setError(conflictMessage(category.parent_id));
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
    const parent = parentId === ROOT ? null : parentId;
    const target = { parentId: parent, kind, shareGroupId, ownerId };
    const conflict = findNameConflict(workspace.tree, { ...target, name });
    if (conflict !== null) {
      setError(conflictMessage(parent));
      return;
    }
    try {
      await createCategory({
        shareGroupId,
        kind,
        name: normalizeCategoryName(name),
        color: '#4a6fa5',
        // 表示順は同じ親の中で決まる（§3.4）
        sortOrder: nextSortOrder(siblingsOf(workspace.tree, target)),
        parentId: parent,
      });
      setName('');
      await workspace.reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '作れませんでした');
    }
  }

  /** 同じ親の中で1つ上（下）へ動かす（列14・列23） */
  async function move(category: Category, direction: 'up' | 'down') {
    setError('');
    const siblings = siblingsOf(workspace.tree, {
      parentId: category.parent_id,
      kind: category.kind,
      shareGroupId: category.share_group_id,
      ownerId: category.owner_id,
    });
    const changed = reorder(siblings, category.id, direction);
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

    // 移動の単位は大分類。配下の小分類の取引も対象に含める（§5.2）
    const childIds = childrenOf(workspace.tree, categoryId).map((c) => c.id);
    const transactions = (await loadTransactions({})).filter(
      (tx) => tx.category_id === categoryId || childIds.includes(tx.category_id),
    );
    const check = checkMove({
      source: { shareGroupId: category.share_group_id, ownerId: category.owner_id },
      dest: { shareGroupId: destShareGroupId, ownerId: destOwnerId },
      kind: category.kind,
      name: category.name,
      categories: workspace.tree,
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

  async function apply(run: Promise<void>, failed: string) {
    setError('');
    try {
      await run;
      await workspace.reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : failed);
    }
  }

  const actions: RowActions = {
    rename: (categoryId, raw) => void rename(categoryId, raw),
    move: (category, direction) => void move(category, direction),
    remove: (categoryId) => void apply(deleteCategory(categoryId), '消せませんでした'),
    update: (categoryId, patch) =>
      void apply(updateCategory(categoryId, patch), '変えられませんでした'),
    startMove: (categoryId, dest) => void startMove(categoryId, dest, false),
  };

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
          <Select
            value={scope}
            onChange={(e) => {
              setScope(e.target.value);
              // 共有範囲が変わると親の候補も変わる
              setParentId(ROOT);
            }}
            aria-label="共有範囲"
          >
            <option value={OWN}>個人</option>
            {workspace.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="親カテゴリ">
          <Select
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            aria-label="親カテゴリ"
          >
            <option value={ROOT}>なし（大分類にする）</option>
            {parentOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
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
        const movable = group.items.filter((c) => !c.is_system && c.parent_id === null);
        // DB の行を持ったままツリーの順に並べる（並べ替えたあとで引き直さない）
        const tree = orderedTree(group.items.map((c) => ({ ...toTreeCategory(c), row: c })));
        return (
          <Card key={group.key} className="flex flex-col gap-2">
            <ScopeTag
              label={workspace.scopeLabel({ share_group_id: group.shareGroupId })}
              kind={group.shareGroupId === null ? 'own' : 'group'}
            />
            {tree.map(({ root, children }) => {
              const childRows = children.map((c) => c.row);
              return (
                <div key={root.id} className="flex flex-col gap-2">
                  <CategoryRow
                    category={root.row}
                    siblings={movable}
                    groups={workspace.groups}
                    actions={actions}
                  />
                  {childRows.map((child) => (
                    <CategoryRow
                      key={child.id}
                      category={child}
                      siblings={childRows}
                      groups={workspace.groups}
                      actions={actions}
                    />
                  ))}
                </div>
              );
            })}
          </Card>
        );
      })}

      <Note>
        カテゴリは2段まで分けられます。小分類を削除するとその取引は親へ、大分類を削除すると同じ
        共有範囲・同じ収支区分の未分類へ移ります。小分類が残っている大分類と未分類は削除できません
      </Note>
    </main>
  );
}
