/**
 * Supabase への接続設定を環境変数から読む。
 *
 * 設定が欠けていても例外を投げない。投げるとモジュールの評価が止まって画面が真っ白になり、
 * 何が足りないのか誰にも分からなくなる。判定だけを返し、画面に出すのは App の仕事。
 */

export type SupabaseConfig =
  | { ok: true; url: string; publicKey: string }
  | { ok: false; message: string };

/** 公開キーの呼び名は Supabase 側で anon key から publishable key に変わった。どちらでも受ける。 */
export function readSupabaseConfig(env: Record<string, string | undefined>): SupabaseConfig {
  const url = env.VITE_SUPABASE_URL ?? '';
  const publicKey = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || '';

  const missing: string[] = [];
  if (url === '') missing.push('VITE_SUPABASE_URL');
  if (publicKey === '') missing.push('VITE_SUPABASE_ANON_KEY（または VITE_SUPABASE_PUBLISHABLE_KEY）');
  if (missing.length > 0) {
    return {
      ok: false,
      message: `${missing.join(' と ')} が設定されていません。開発中は .env.example を .env.local にコピーし、npm run db:status の値を書き写してください。配信では GitHub Actions の Secrets に登録してください。`,
    };
  }

  return { ok: true, url, publicKey };
}
