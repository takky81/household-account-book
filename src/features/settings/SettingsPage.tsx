/** 設定画面（§6）。表示名・色・既定のカテゴリ・テーマ・ログアウト。 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, ErrorText, Field, Note, Select, TextInput } from '../../components/ui';
import { supabase } from '../../lib/supabase';
import { updateProfile } from '../../lib/db';
import { useAuth, useWorkspace } from '../app/context';
import { applyTheme, loadTheme, resolveTheme, saveTheme, type ThemeSetting } from '../../lib/theme';

export function SettingsPage() {
  const workspace = useWorkspace();
  const { userId } = useAuth();
  const selfId = userId!;
  const profile = workspace.profiles.find((p) => p.id === selfId)!;
  const [error, setError] = useState('');
  const [setting, setSetting] = useState<ThemeSetting>(() => loadTheme());

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
        表示名は CSV が人を指すのに使うため一意。`共用` `個人` `:` `;` は使えない（§3.1）
      </Note>
    </main>
  );
}
