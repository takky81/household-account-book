/** 設定画面（§6）。表示名・色・既定のカテゴリ・テーマ・パスワード変更・ログアウト。 */

import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, ErrorText, Field, Note, Select, TextInput } from '../../components/ui';
import { supabase } from '../../lib/supabase';
import { updateProfile } from '../../lib/db';
import { useAuth, useWorkspace } from '../app/context';
import { applyTheme, loadTheme, resolveTheme, saveTheme, type ThemeSetting } from '../../lib/theme';
import {
  CURRENT_PASSWORD_WRONG,
  PASSWORD_CHANGED,
  PASSWORD_CHANGE_FAILED,
  PASSWORD_MIN_LENGTH,
  validatePasswordChange,
} from '../auth/validation';

export function SettingsPage() {
  const workspace = useWorkspace();
  const { session, userId } = useAuth();
  const selfId = userId!;
  const email = session!.user.email ?? '';
  const profile = workspace.profiles.find((p) => p.id === selfId)!;
  const [error, setError] = useState('');
  const [setting, setSetting] = useState<ThemeSetting>(() => loadTheme());
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    applyTheme(resolveTheme(setting, window.matchMedia('(prefers-color-scheme: dark)').matches));
  }, [setting]);

  async function patch(next: Parameters<typeof updateProfile>[1]) {
    setError('');
    try {
      await updateProfile(selfId, next);
      await workspace.reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '保存できませんでした');
    }
  }

  /** パスワードを変える（決定表「認証」列9〜列13）。忘れたときの再設定は持たない（§2.3）。 */
  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setChanged(false);
    // 書式が整っていなければ通信しない（列11・列12・列13）
    const check = validatePasswordChange(currentPassword, newPassword, confirmPassword);
    if (!check.ok) {
      setPasswordError(check.message);
      return;
    }
    if (busy) return;
    setBusy(true);
    setPasswordError('');
    // Supabase は更新時に本人確認をしない。端末を離れた隙に変えられないよう、
    // ここで現在のパスワードを使ってログインし直して確かめる（列10）
    const reauth = await supabase.auth.signInWithPassword({ email, password: currentPassword });
    if (reauth.error !== null) {
      setBusy(false);
      setPasswordError(CURRENT_PASSWORD_WRONG);
      return;
    }
    const { error: failure } = await supabase.auth.updateUser({ password: newPassword });
    setBusy(false);
    if (failure !== null) {
      setPasswordError(PASSWORD_CHANGE_FAILED);
      return;
    }
    // 入力欄に新しいパスワードを残さない
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setChanged(true);
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-3 p-3">
      <h1 className="text-lg font-bold">設定</h1>
      <ErrorText>{error}</ErrorText>

      <Card className="flex flex-col gap-2">
        <Field label="表示名">
          <TextInput
            aria-label="表示名"
            defaultValue={profile.display_name}
            onBlur={(e) => void patch({ display_name: e.target.value })}
          />
        </Field>
        <Field label="色">
          <TextInput
            type="color"
            aria-label="色"
            defaultValue={profile.color}
            onBlur={(e) => void patch({ color: e.target.value })}
          />
        </Field>
        <Field label="入力時の既定カテゴリ">
          <Select
            aria-label="既定カテゴリ"
            defaultValue={profile.default_category_id ?? ''}
            onChange={(e) =>
              void patch({ default_category_id: e.target.value === '' ? null : e.target.value })
            }
          >
            <option value="">選ばない</option>
            {workspace.categories
              .filter((c) => !c.is_archived)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {workspace.scopeLabel(c)} / {c.name}
                </option>
              ))}
          </Select>
        </Field>
      </Card>

      <Card className="flex flex-col gap-2">
        <h2 className="text-sm font-bold">表示</h2>
        <div className="flex gap-2">
          {(
            [
              { value: null, label: 'OS に合わせる' },
              { value: 'light', label: 'ライト' },
              { value: 'dark', label: 'ダーク' },
            ] as { value: ThemeSetting; label: string }[]
          ).map((option) => (
            <Button
              key={option.label}
              variant={option.value === setting ? 'primary' : 'ghost'}
              onClick={() => {
                setSetting(option.value);
                saveTheme(option.value);
              }}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </Card>

      <Card className="flex flex-col gap-2">
        <h2 className="text-sm font-bold">パスワード</h2>
        <form className="flex flex-col gap-2" onSubmit={changePassword}>
          <Field label="現在のパスワード">
            <TextInput
              aria-label="現在のパスワード"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </Field>
          <Field label="新しいパスワード" hint={`${PASSWORD_MIN_LENGTH}文字以上`}>
            <TextInput
              aria-label="新しいパスワード"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </Field>
          <Field label="新しいパスワード（確認）">
            <TextInput
              aria-label="新しいパスワード（確認）"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </Field>
          <ErrorText>{passwordError}</ErrorText>
          {changed && (
            <p role="status" className="text-xs text-[var(--c-income)]">
              {PASSWORD_CHANGED}
            </p>
          )}
          <Button type="submit" disabled={busy}>
            パスワードを変更
          </Button>
        </form>
      </Card>

      <Card className="flex flex-col gap-2">
        <h2 className="text-sm font-bold">管理</h2>
        <Link className="text-sm text-[var(--c-link)]" to="/categories">
          カテゴリ
        </Link>
        <Link className="text-sm text-[var(--c-link)]" to="/groups">
          共有グループ
        </Link>
        <Link className="text-sm text-[var(--c-link)]" to="/import">
          インポート
        </Link>
        <Link className="text-sm text-[var(--c-link)]" to="/export">
          エクスポート
        </Link>
      </Card>

      <Button variant="ghost" onClick={() => void supabase.auth.signOut()}>
        ログアウト
      </Button>

      <Note>
        表示名はほかの人と重ならない名前にしてください。`共用` `個人` `:` `;` は使えません
      </Note>
    </main>
  );
}
