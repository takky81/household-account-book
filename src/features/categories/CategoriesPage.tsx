/**
 * カテゴリ管理（決定表「カテゴリの管理」）。
 *
 * カテゴリは全ユーザー共通のマスタ（§2.4 / §3.4）。共有範囲を持たないので、
 * この画面に共有範囲の選択も、共有範囲を変える操作も無い。
 *
 * 縛るのは削除だけ。他人の取引が黙って未分類へ飛ぶのを止める。改名は止めない
 * （誤字直しと意味の付け替えを機械では見分けられない）。代わりに、他の人が使っている
 * カテゴリを改名するときは、影響する件数を出して保存前に確かめる。
 */

import { useState } from 'react';
import {
  Button,
  Card,
  ConfirmDialog,
  ErrorText,
  Field,
  Note,
  Select,
  Tabs,
  TextInput,
} from '../../components/ui';
import {
  createCategory,
  deleteCategory,
  loadCategoryUsage,
  updateCategory,
  type Category,
  type CategoryUsage,
} from '../../lib/db';
import { useWorkspace } from '../app/context';
import { findNameConflict, normalizeCategoryName, validateCategoryName, type Kind } from './name';
import { nextSortOrder, reorder } from './order';
import { canBeParent, orderedTree, siblingsOf } from './tree';
import { toTreeCategory } from '../app/model';

/** 親を選ばない（大分類として作る） */
const ROOT = '';

/** 名前が衝突したときの知らせ方。大分類と小分類で見る範囲が違う（§3.4） */
function conflictMessage(parentId: string | null): string {
  return parentId === null
    ? '同じ収支区分に同じ名前のカテゴリがあります'
    : '同じ大分類に同じ名前の小分類があります';
}

/** 他の人がこのカテゴリを使っているか。改名の確認と削除の可否を分ける境目 */
function usedByOthers(usage: CategoryUsage): boolean {
  return usage.others_transactions > 0 || usage.others_rules > 0 || usage.others_budgets > 0;
}

/** 改名の影響。何がどれだけ書き換わって見えるかを、数で伝える */
function impactMessage(usage: CategoryUsage): string {
  const parts: string[] = [];
  if (usage.transactions > 0) parts.push(`取引 ${usage.transactions} 件`);
  if (usage.rules > 0) parts.push(`定期登録 ${usage.rules} 件`);
  if (usage.budgets > 0) parts.push(`予算 ${usage.budgets} 件`);
  const what = parts.length === 0 ? 'まだ使われていません' : parts.join(' / ');
  return `このカテゴリは${what}。あなた以外に ${usage.others} 人が使っています。` +
    '改名すると、その人たちの記録の見出しもまとめて変わります。';
}

type RowActions = {
  rename: (categoryId: string, raw: string) => void;
  move: (category: Category, direction: 'up' | 'down') => void;
  remove: (categoryId: string) => void;
  update: (categoryId: string, patch: { color?: string; is_archived?: boolean }) => void;
};

/** 一覧の1行。小分類は親の下にぶら下げて見せる（§3.4.1） */
function CategoryRow({
  category,
  siblings,
  actions,
}: {
  category: Category;
  siblings: Category[];
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

/** 改名の確認。他の人が使っているカテゴリのときだけ出す */
type RenameConfirm = { categoryId: string; from: string; to: string; usage: CategoryUsage };

/** 削除の確認。消したあと取引がどこへ移るかは親を持つかで変わる（§3.4.1） */
type RemoveConfirm = { category: Category; usage: CategoryUsage };

/** 削除でこのカテゴリの取引がどこへ行くか。数と行き先を添えて確かめる（1要素=1行） */
function removeMessage({ category, usage }: RemoveConfirm): string[] {
  const destination = category.parent_id === null ? '同じ収支区分の未分類' : '親の大分類';
  const moved =
    usage.transactions === 0
      ? 'このカテゴリを使った取引はありません'
      : `取引 ${usage.transactions} 件が${destination}へ移ります`;
  return [`${moved}。元に戻せません`, 'アーカイブなら記録をそのままに、新規の選択肢から外せます'];
}

export function CategoriesPage() {
  const workspace = useWorkspace();
  const [kind, setKind] = useState<Kind>('expense');
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState<string>(ROOT);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<RenameConfirm | null>(null);
  const [removing, setRemoving] = useState<RemoveConfirm | null>(null);

  /** 追加フォームで親に選べる大分類（未分類は親になれない。§3.4.1） */
  const parentOptions = workspace.tree.filter((c) => canBeParent(c) && c.kind === kind);

  /** 実際に名前を書き換える。確認を経たあともここへ来る */
  async function applyRename(categoryId: string, to: string) {
    setConfirm(null);
    try {
      await updateCategory(categoryId, { name: to });
      await workspace.reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '変えられませんでした');
    }
  }

  /**
   * 名前を変える。同じ収支区分・同じ親の同名は保存する前に弾く（列3・列16）。
   * 他の人が使っているカテゴリなら、影響の件数を見せて確かめる（列25）。
   */
  async function rename(categoryId: string, raw: string) {
    setError('');
    setConfirm(null);
    const category = workspace.categories.find((c) => c.id === categoryId);
    const to = normalizeCategoryName(raw);
    if (category === undefined || to === category.name) return;
    const check = validateCategoryName(raw);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    const conflict = findNameConflict(
      workspace.tree,
      { kind: category.kind, name: raw, parentId: category.parent_id },
      categoryId,
    );
    if (conflict !== null) {
      setError(conflictMessage(category.parent_id));
      return;
    }
    try {
      const usage = await loadCategoryUsage(categoryId);
      if (usedByOthers(usage)) {
        setConfirm({ categoryId, from: category.name, to, usage });
        return;
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '影響を数えられませんでした');
      return;
    }
    await applyRename(categoryId, to);
  }

  /**
   * 削除を押したとき。他の人の取引が黙って未分類へ移るのを止める（列23）。
   * DB 側も同じ検査をするが、先に画面で件数を出してアーカイブへ誘導する。
   * 消せるものは、影響の件数を見せて確かめてから消す（決定表「表示設定と共通の振る舞い」列9）。
   */
  async function remove(categoryId: string) {
    setError('');
    setConfirm(null);
    setRemoving(null);
    const category = workspace.categories.find((c) => c.id === categoryId);
    if (category === undefined) return;
    try {
      const usage = await loadCategoryUsage(categoryId);
      if (usedByOthers(usage)) {
        setError(
          `他の ${usage.others} 人が使っているカテゴリは削除できません。` +
            'アーカイブすると、これまでの記録を残したまま新規の選択肢から外せます',
        );
        return;
      }
      setRemoving({ category, usage });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '影響を数えられませんでした');
    }
  }

  /** 確認を経たあとに実際に消す。小分類が残る大分類などは DB 側が止める（列21） */
  async function applyRemove(categoryId: string) {
    setRemoving(null);
    try {
      await deleteCategory(categoryId);
      await workspace.reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '消せませんでした');
    }
  }

  async function add() {
    setError('');
    const check = validateCategoryName(name);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    const parent = parentId === ROOT ? null : parentId;
    const target = { parentId: parent, kind };
    const conflict = findNameConflict(workspace.tree, { ...target, name });
    if (conflict !== null) {
      setError(conflictMessage(parent));
      return;
    }
    try {
      await createCategory({
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

  const actions: RowActions = {
    rename: (categoryId, raw) => void rename(categoryId, raw),
    move: (category, direction) => void move(category, direction),
    remove: (categoryId) => void remove(categoryId),
    update: (categoryId, patch) =>
      void (async () => {
        setError('');
        try {
          await updateCategory(categoryId, patch);
          await workspace.reload();
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : '変えられませんでした');
        }
      })(),
  };

  const rows = workspace.categories.filter((c) => c.kind === kind);
  // 未分類は常に末尾（sort_order 9999）なので並べ替えの対象から外す
  const movable = rows.filter((c) => !c.is_system && c.parent_id === null);
  // DB の行を持ったままツリーの順に並べる（並べ替えたあとで引き直さない）
  const tree = orderedTree(rows.map((c) => ({ ...toTreeCategory(c), row: c })));

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

      {confirm !== null && (
        <Card className="flex flex-col gap-2">
          <p className="text-sm" role="alert">
            「{confirm.from}」を「{confirm.to}」に変えます。
          </p>
          <p className="text-xs text-[var(--c-muted)]">{impactMessage(confirm.usage)}</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              やめる
            </Button>
            <Button onClick={() => void applyRename(confirm.categoryId, confirm.to)}>
              変える
            </Button>
          </div>
        </Card>
      )}

      <Card className="flex flex-col gap-2">
        {tree.map(({ root, children }) => {
          const childRows = children.map((c) => c.row);
          return (
            <div key={root.id} className="flex flex-col gap-2">
              <CategoryRow category={root.row} siblings={movable} actions={actions} />
              {childRows.map((child) => (
                <CategoryRow
                  key={child.id}
                  category={child}
                  siblings={childRows}
                  actions={actions}
                />
              ))}
            </div>
          );
        })}
      </Card>

      {removing !== null && (
        <ConfirmDialog
          title={`「${removing.category.name}」を削除しますか`}
          detail={removeMessage(removing)}
          confirmLabel="削除する"
          onConfirm={() => void applyRemove(removing.category.id)}
          onCancel={() => setRemoving(null)}
        />
      )}

      <Note>
        カテゴリは全員で共有します。改名も並べ替えも誰でもできますが、他の人が使っている
        カテゴリの改名は、その人たちの記録の見出しも変えるため確認します。削除は自分しか
        使っていないときだけです。代わりにアーカイブすると、記録を残したまま新規の選択肢から
        外せます。カテゴリは2段まで分けられ、小分類を削除するとその取引は親へ、大分類を
        削除すると同じ収支区分の未分類へ移ります
      </Note>
    </main>
  );
}
