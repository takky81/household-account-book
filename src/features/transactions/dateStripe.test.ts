import { stripeDateGroups } from './dateStripe';

describe('取引一覧の日付グループ', () => {
  it('列13 日付が飛んでいても、表示順の日付グループごとに色を交互にする', () => {
    const striped = stripeDateGroups([
      { id: 'a', occurred_on: '2026-09-19' },
      { id: 'b', occurred_on: '2026-09-19' },
      { id: 'c', occurred_on: '2026-09-15' },
      { id: 'd', occurred_on: '2026-08-30' },
      { id: 'e', occurred_on: '2026-08-02' },
    ]);

    expect(striped.map(({ row, tinted }) => [row.id, tinted])).toEqual([
      ['a', true],
      ['b', true],
      ['c', false],
      ['d', true],
      ['e', false],
    ]);
  });

  it('空の一覧は空のまま返す', () => {
    expect(stripeDateGroups([])).toEqual([]);
  });
});
