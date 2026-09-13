/** 共有グループ管理（決定表「共有グループの管理」）。 */

import { useState } from 'react';
import {
  Button,
  Card,
  ConfirmDialog,
  ErrorText,
  Field,
  Note,
  TextInput,
} from '../../components/ui';
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

/** 確認を待っている消す操作。 */
type Pending =
  | { kind: 'group'; groupId: string; name: string }
  | { kind: 'member'; groupId: string; userId: string; name: string; groupName: string };

export function GroupsPage() {
  const workspace = useWorkspace();
  const { userId } = useAuth();
  const selfId = userId!;
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>([selfId]);
  const [error, setError] = useState('');
  /**
   * 消す操作は押した時点では行わず、確認ダイアログを経る。
   * グループごと消すのか、メンバー1人を外すのかで文面が変わる
   */
  const [pending, setPending] = useState<Pending | null>(null);

  async function removeGroup(group: { id: string; name: string }) {
    setPending(null);
    setError('');
    try {
      await deleteShareGroup(group.id);
      await workspace.reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '消せませんでした');
    }
  }

  async function removeMember(groupId: string, userId: string) {
    setPending(null);
    setError('');
    try {
      await removeGroupMember(groupId, userId);
      await workspace.reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '外せませんでした');
    }
  }

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
                onClick={() => setPending({ kind: 'group', groupId: group.id, name: group.name })}
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
                    aria-label={`${workspace.displayName(member.userId)}をグループから外す`}
                    onClick={() => {
                      setError('');
                      // 最後の1人は外せない。確認を出す前にここで止める
                      const check = canRemoveMember(members, member.userId);
                      if (!check.ok) {
                        setError(check.message);
                        return;
                      }
                      setPending({
                        kind: 'member',
                        groupId: group.id,
                        userId: member.userId,
                        name: workspace.displayName(member.userId),
                        groupName: group.name,
                      });
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

      {pending !== null &&
        (pending.kind === 'group' ? (
          <ConfirmDialog
            title={`「${pending.name}」を削除しますか`}
            detail={[
              'このグループで入力した取引が残っていると削除できません',
              'メンバーと既定の負担割合の設定は消えます',
            ]}
            confirmLabel="削除する"
            onConfirm={() => void removeGroup({ id: pending.groupId, name: pending.name })}
            onCancel={() => setPending(null)}
          />
        ) : (
          <ConfirmDialog
            title={`${pending.name}を「${pending.groupName}」から外しますか`}
            detail={[
              'すでに入力した取引の負担は変わりません',
              '外した人はこのグループの取引を見られなくなります',
            ]}
            confirmLabel="外す"
            onConfirm={() => void removeMember(pending.groupId, pending.userId)}
            onCancel={() => setPending(null)}
          />
        ))}

      <Note>
        負担割合を変えても、すでに入力した取引の負担は変わりません。メンバーは最後の1人を外せません
      </Note>
    </main>
  );
}
