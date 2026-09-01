import { createClient } from '@supabase/supabase-js';
import { readSupabaseConfig } from './config';

const config = readSupabaseConfig(
  import.meta.env as unknown as Record<string, string | undefined>,
);

/** 接続設定が足りないときの案内。null なら設定は揃っている。画面に出すのは App の仕事。 */
export const configError = config.ok ? null : config.message;

// 設定が無くても import は通す。ここで投げると画面が真っ白になり、原因が誰にも見えない。
export const supabase = createClient(
  config.ok ? config.url : 'http://127.0.0.1:54321',
  config.ok ? config.publicKey : 'missing-key',
);
