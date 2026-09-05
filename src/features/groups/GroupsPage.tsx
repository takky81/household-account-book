/** 共有グループ管理（決定表「共有グループの管理」）。 */

import { useState } from 'react';
import { Button, Card, ErrorText, Field, Note, TextInput } from '../../components/ui';
import {
  addGroupMember,
  createShareGroup,
  deleteShareGroup,
  removeGroupMember,
  updateGroupName,
  updateMemberWeight,
} from '../../lib/db';
import { useAuth, useWorkspace } from '../app/context';
import { canAddMember, canRemoveMember, validateNewGroup } from './members';

export function GroupsPage() {
  const workspace = useWorkspace();
  const { userId } = useAuth();
  const selfId = userId!;
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>([selfId]);
  const [error, setError] = useState('');

  async function create() {
    setError('');
    const check = validateNewGroup({
      name,
      memberIds: picked,
      selfId,
      existingNames: workspace.groups.map((g) => g.name),
    });
    if (!check.ok) {
      setError(check.message);
      return;
    }
    try {
      await createShareGroup({
        name,
        members: picked.map((userId, index) => ({
          userId,
          defaultWeight: 1,
          sortOrder: (index + 1) * 10,
        })),
      });
      setName('');
      setPicked([selfId]);
      await workspace.reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '作れませんでした');
    }
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-3 p-3">
      <h1 className="text-lg font-bold">共有グループ</h1>
      <ErrorText>{error}</ErrorText>

      {workspace.groups.map((group) => {
        const members = workspace.membersOf(group.id);
        return (
          <Card key={group.id} className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <TextInput
                aria-label={`${group.name}の名前`}
                defaultValue={group.name}
                onBlur={async (e) => {
                  if (e.target.value === group.name) return;
                  setError('');
                  try {
                    await updateGroupName(group.id, e.target.value);
                    await workspace.reload();
                  } catch (failure) {
                    setError(failure instanceof Error ? failure.message : '変えられませんでした');
                  }
                }}
              />
              <button
                type="button"
                className="text-xs text-[var(--c-warn)]"
                onClick={async () => {
                  setError('');
                  try {
                    await deleteShareGroup(group.id);
                    await workspace.reload();
                  } catch (failure) {
                    setError(failure instanceof Error ? failure.message : '消せませんでした');
                  }
                }}
              >
                グループを削除
              </button>
            </div>

            {members.map((member) => (
              <div key={member.userId} className="flex items-center justify-between gap-2">
                <span className="text-sm">{workspace.displayName(member.userId)}</span>
                <span className="flex items-center gap-2">
                  <TextInput
                    aria-label={`${workspace.displayName(member.userId)}の負担割合`}
                    className="w-16 text-right"
                    defaultValue={String(member.defaultWeight)}
                    onBlur={async (e) => {
                      const weight = Number(e.target.value);
                      if (!Number.isInteger(weight) || weight < 0) {
                        setError('負担割合は0以上の整数にしてください');
                        return;
                      }
                      await updateMemberWeight({
                        shareGroupId: group.id,
                        userId: member.userId,
                        defaultWeight: weight,
                      });
                      await workspace.reload();
                    }}
                  />
                  <button
                    type="button"
                    className="text-xs"
                    onClick={async () => {
                      setError('');
                      const check = canRemoveMember(members, member.userId);
                      if (!check.ok) {
                        setError(check.message);
                        return;
                      }
                      try {
                        await removeGroupMember(group.id, member.userId);
                        await workspace.reload();
                      } catch (failure) {
                        setError(failure instanceof Error ? failure.message : '外せませんでした');
                      }
                    }}
                  >
                    外す
                  </button>
                </span>
              </div>
            ))}

            <select
              aria-label={`${group.name}にメンバーを追加`}
              className="rounded border border-[var(--c-edge)] bg-[var(--c-panel)] px-2 py-1 text-sm"
              defaultValue=""
              onChange={async (e) => {
                const target = e.target.value;
                e.target.value = '';
                if (target === '') return;
                setError('');
                const check = canAddMember(members, target);
                if (!check.ok) {
                  setError(check.message);
                  return;
                }
                try {
                  await addGroupMember({
                    shareGroupId: group.id,
                    userId: target,
                    defaultWeight: 1,
                    sortOrder: (members.length + 1) * 10,
                  });
                  await workspace.reload();
                } catch (failure) {
                  setError(failure instanceof Error ? failure.message : '追加できませんでした');
                }
              }}
            >
              <option value="">＋ メンバーを追加</option>
              {workspace.profiles
                .filter((p) => !members.some((m) => m.userId === p.id))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_name}
                  </option>
                ))}
            </select>
          </Card>
        );
      })}

      <Card className="flex flex-col gap-2">
        <h2 className="text-sm font-bold">グループを作る</h2>
        <Field label="名前">
          <TextInput aria-label="グループ名" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <fieldset className="flex flex-col gap-1">
          <legend className="text-xs text-[var(--c-muted)]">メンバー</legend>
          {workspace.profiles.map((profile) => (
            <label key={profile.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={picked.includes(profile.id)}
                onChange={(e) =>
                  setPicked(
                    e.target.checked
                      ? [...picked, profile.id]
                      : picked.filter((id) => id !== profile.id),
                  )
                }
              />
              {profile.display_name}
            </label>
          ))}
        </fieldset>
        <Button onClick={() => void create()}>作る</Button>
      </Card>

      <Note>
        負担割合を変えても、すでに入力した取引の負担は変わりません。メンバーは最後の1人を外せません
      </Note>
    </main>
  );
}
