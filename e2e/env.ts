import { readFileSync } from 'node:fs';

/** .env.local を読む。E2E はローカルの Supabase に対して走る。 */
function readEnvLocal(): Record<string, string> {
  const text = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  return Object.fromEntries(
    text
      .split('\n')
      .filter((line) => line.includes('='))
      .map((line) => {
        const i = line.indexOf('=');
        return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
      }),
  );
}

const env = readEnvLocal();

export const SUPABASE_URL = env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54421';
export const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY ?? '';

/**
 * E2E で使う利用者。global-setup が存在を保証する。
 * 表示名は auth.users のトリガがメールのローカル部から作る（§3.1）。
 */
export const TARO = { email: 'taro@example.test', password: 'e2epassword', name: 'taro' };
export const HANA = { email: 'hana@example.test', password: 'e2epassword', name: 'hana' };
/** どのグループにも属さない人。見えないことの確認に使う。 */
export const OTHER = { email: 'other@example.test', password: 'e2epassword', name: 'other' };
