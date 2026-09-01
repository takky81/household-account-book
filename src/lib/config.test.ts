import { describe, it, expect } from 'vitest';
import { readSupabaseConfig } from './config';

describe('readSupabaseConfig', () => {
  it('URL と anon key が揃っていれば設定を返す', () => {
    const config = readSupabaseConfig({
      VITE_SUPABASE_URL: 'http://127.0.0.1:54421',
      VITE_SUPABASE_ANON_KEY: 'key',
    });
    expect(config).toEqual({ ok: true, url: 'http://127.0.0.1:54421', publicKey: 'key' });
  });

  it('publishable key の名前でも受ける', () => {
    const config = readSupabaseConfig({
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
    });
    expect(config).toEqual({
      ok: true,
      url: 'https://example.supabase.co',
      publicKey: 'sb_publishable_x',
    });
  });

  it('両方の名前があるときは publishable key を使う', () => {
    const config = readSupabaseConfig({
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'publishable',
    });
    expect(config).toMatchObject({ ok: true, publicKey: 'publishable' });
  });

  it('URL が無いときは、何を設定すればよいかを言う', () => {
    const config = readSupabaseConfig({ VITE_SUPABASE_ANON_KEY: 'key' });
    expect(config.ok).toBe(false);
    if (config.ok) throw new Error('ここには来ない');
    expect(config.message).toContain('VITE_SUPABASE_URL');
  });

  it('キーが無いときは、その名前を言う', () => {
    const config = readSupabaseConfig({ VITE_SUPABASE_URL: 'http://127.0.0.1:54421' });
    expect(config.ok).toBe(false);
    if (config.ok) throw new Error('ここには来ない');
    expect(config.message).toContain('VITE_SUPABASE_ANON_KEY');
  });

  it('空文字は未設定として扱う', () => {
    const config = readSupabaseConfig({ VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' });
    expect(config.ok).toBe(false);
  });
});
