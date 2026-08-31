/** ログイン画面（決定表「認証」）。サインアップ導線は持たない。 */

import { useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { Button, Card, ErrorText, Field, TextInput } from '../../components/ui';
import { signInErrorMessage, validateCredentials } from './validation';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    // 書式が整っていなければ通信しない（列4）
    const check = validateCredentials(email, password);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    if (busy) return;
    setBusy(true);
    setError('');
    const { error: failure } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    // 理由によらず同じ文言にする（列2・列3）
    if (failure !== null) setError(signInErrorMessage(failure.message));
  }

  return (
    <main className="mx-auto max-w-sm p-6">
      <Card>
        <h1 className="mb-3 text-lg font-bold">家計簿</h1>
        <form className="flex flex-col gap-3" onSubmit={submit}>
          <Field label="メールアドレス">
            <TextInput
              name="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="パスワード">
            <TextInput
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <ErrorText>{error}</ErrorText>
          <Button type="submit" disabled={busy}>
            ログイン
          </Button>
        </form>
      </Card>
    </main>
  );
}
