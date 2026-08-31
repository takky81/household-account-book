import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
// 公開キーの呼び名は Supabase 側で anon key から publishable key に変わった。
// ローカルは前者、新しいプロジェクトは後者を出すので、どちらの名前でも受ける。
const publicKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !publicKey) {
  throw new Error(
    'VITE_SUPABASE_URL と VITE_SUPABASE_ANON_KEY（または VITE_SUPABASE_PUBLISHABLE_KEY）' +
      'が設定されていません。.env.example を .env.local にコピーし、' +
      'npm run db:status の値を書き写してください。',
  );
}

export const supabase = createClient(url, publicKey);
