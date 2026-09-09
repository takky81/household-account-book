import { describe, it, expect } from 'vitest';
import {
  canBeParent,
  categoryPath,
  childrenOf,
  isSelectable,
  orderedTree,
  rootIdOf,
  selectableCategories,
  siblingsOf,
  type TreeCategory,
} from './tree';

const make = (over: Partial<TreeCategory> & { id: string }): TreeCategory => ({
  parentId: null,
  name: '食費',
  kind: 'expense',
  sortOrder: 10,
  isSystem: false,
  isArchived: false,
  ...over,
});

/** 夫婦の支出：食費（外食・自炊）／日用品／未分類 */
const 食費 = make({ id: 'c-food', name: '食費', sortOrder: 10 });
const 外食 = make({ id: 'c-eat', name: '外食', parentId: 'c-food', sortOrder: 20 });
const 自炊 = make({ id: 'c-cook', name: '自炊', parentId: 'c-food', sortOrder: 10 });
const 日用品 = make({ id: 'c-daily', name: '日用品', sortOrder: 20 });
const 未分類 = make({ id: 'c-sys', name: '未分類', sortOrder: 9999, isSystem: true });
const all = [外食, 食費, 未分類, 自炊, 日用品];

describe('childrenOf', () => {
  it('列15 小分類を表示順で並べる', () => {
    expect(childrenOf(all, 'c-food').map((c) => c.name)).toEqual(['自炊', '外食']);
  });

  it('小分類を持たない大分類では空になる', () => {
    expect(childrenOf(all, 'c-daily')).toEqual([]);
  });
});

describe('canBeParent', () => {
  it('列15・列18・列19 親になれるのは未分類でない大分類だけ', () => {
    expect(canBeParent(食費)).toBe(true);
    expect(canBeParent(外食)).toBe(false);
    expect(canBeParent(未分類)).toBe(false);
  });
});

describe('siblingsOf', () => {
  it('列23 小分類の兄弟は同じ親の小分類だけ', () => {
    expect(siblingsOf(all, 外食).map((c) => c.name)).toEqual(['自炊', '外食']);
  });

  it('列14 大分類の兄弟は同じ収支区分の大分類だけ（未分類を除く）', () => {
    expect(siblingsOf(all, 食費).map((c) => c.name)).toEqual(['食費', '日用品']);
  });

  it('カテゴリは全ユーザー共通なので、共有範囲では兄弟が分かれない', () => {
    const 交際費 = make({ id: 'c-party', name: '交際費', sortOrder: 30 });
    expect(siblingsOf([...all, 交際費], 交際費).map((c) => c.id)).toContain('c-party');
    expect(siblingsOf([...all, 交際費], 交際費).length).toBe(3);
  });
});

describe('isSelectable', () => {
  it('列22 親がアーカイブ済みなら小分類も候補から外れる', () => {
    const 親 = { ...食費, isArchived: true };
    const rows = [親, 外食, 自炊, 日用品, 未分類];
    expect(isSelectable(rows, 親)).toBe(false);
    // 子の is_archived は false のままでも外れる
    expect(外食.isArchived).toBe(false);
    expect(isSelectable(rows, 外食)).toBe(false);
    expect(isSelectable(rows, 日用品)).toBe(true);
  });

  it('列8 自分がアーカイブ済みなら外れる', () => {
    const rows = [食費, { ...外食, isArchived: true }, 自炊];
    expect(isSelectable(rows, rows[1]!)).toBe(false);
    expect(isSelectable(rows, 自炊)).toBe(true);
  });

  it('selectableCategories は候補だけをツリー順で返す', () => {
    const rows = [食費, 外食, 自炊, { ...日用品, isArchived: true }, 未分類];
    expect(selectableCategories(rows).map((c) => c.name)).toEqual([
      '食費',
      '自炊',
      '外食',
      '未分類',
    ]);
  });
});

describe('orderedTree', () => {
  it('列15 大分類の直後にその小分類が並ぶ', () => {
    const tree = orderedTree(all);
    expect(tree.map((node) => node.root.name)).toEqual(['食費', '日用品', '未分類']);
    expect(tree[0]!.children.map((c) => c.name)).toEqual(['自炊', '外食']);
    expect(tree[2]!.children).toEqual([]);
  });
});

describe('categoryPath', () => {
  it('列15 小分類は『大分類 / 小分類』で見せる', () => {
    expect(categoryPath(all, 外食)).toBe('食費 / 外食');
  });

  it('大分類はそのままの名前', () => {
    expect(categoryPath(all, 食費)).toBe('食費');
  });
});

describe('rootIdOf', () => {
  it('集計・予算は大分類の id でまとめる', () => {
    expect(rootIdOf(外食)).toBe('c-food');
    expect(rootIdOf(食費)).toBe('c-food');
  });
});
