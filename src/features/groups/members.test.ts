import { describe, it, expect } from 'vitest';
import { canAddMember, canRemoveMember, validateGroupName, validateNewGroup } from './members';

const members = [
  { userId: 'u1', defaultWeight: 1, sortOrder: 10 },
  { userId: 'u2', defaultWeight: 1, sortOrder: 20 },
];

describe('validateNewGroup', () => {
  it('列2 自分をメンバーに含めないと作れない', () => {
    const result = validateNewGroup({ name: '夫婦', memberIds: ['u2'], selfId: 'u1', existingNames: [] });
    expect(result).toEqual({ ok: false, message: '自分自身をメンバーに含めてください' });
  });

  it('自分を含めていれば作れる', () => {
    expect(
      validateNewGroup({ name: '夫婦', memberIds: ['u1', 'u2'], selfId: 'u1', existingNames: [] }),
    ).toEqual({ ok: true });
  });

  it('列4 同じ名前のグループは作れない', () => {
    const result = validateNewGroup({
      name: '夫婦',
      memberIds: ['u1'],
      selfId: 'u1',
      existingNames: ['夫婦'],
    });
    expect(result.ok).toBe(false);
  });
});

describe('validateGroupName', () => {
  it('列5 個人は予約語なのでグループ名にできない', () => {
    expect(validateGroupName('個人').ok).toBe(false);
  });

  it('列5 前後の空白や空の名前は使えない', () => {
    expect(validateGroupName('  ').ok).toBe(false);
    expect(validateGroupName(' 夫婦 ').ok).toBe(false);
    expect(validateGroupName('夫婦')).toEqual({ ok: true });
  });
});

describe('canAddMember', () => {
  it('列7 すでにメンバーなら追加できない', () => {
    expect(canAddMember(members, 'u1').ok).toBe(false);
  });

  it('メンバーでなければ追加できる', () => {
    expect(canAddMember(members, 'u3')).toEqual({ ok: true });
  });
});

describe('canRemoveMember', () => {
  it('列9 2人以上いれば外せる', () => {
    expect(canRemoveMember(members, 'u2')).toEqual({ ok: true });
  });

  it('列10 最後の1人は外せない', () => {
    expect(canRemoveMember([members[0]!], 'u1')).toEqual({
      ok: false,
      message: '最後のメンバーは外せません',
    });
  });
});
