import { describe, it, expect } from 'vitest';
import { LOGIN_FAILED, signInErrorMessage, validateCredentials } from './validation';

describe('validateCredentials', () => {
  it('列4 メールの書式が不正なら送信しない', () => {
    expect(validateCredentials('taro', 'password')).toEqual({
      ok: false,
      message: 'メールアドレスの形式が正しくありません',
    });
    expect(validateCredentials('', 'password').ok).toBe(false);
  });

  it('列4 パスワードが空なら送信しない', () => {
    expect(validateCredentials('taro@example.com', '')).toEqual({
      ok: false,
      message: 'パスワードを入力してください',
    });
  });

  it('書式が整っていれば送信する', () => {
    expect(validateCredentials('taro@example.com', 'password')).toEqual({ ok: true });
  });
});

describe('signInErrorMessage', () => {
  it('列2 パスワードが違うときの文言', () => {
    expect(signInErrorMessage('Invalid login credentials')).toBe(LOGIN_FAILED);
  });

  it('列3 未登録のメールでも同じ文言にする', () => {
    // アカウントの有無を判別させないため、列2 と同じ文言を返す
    expect(signInErrorMessage('User not found')).toBe(LOGIN_FAILED);
    expect(signInErrorMessage('Invalid login credentials')).toBe(signInErrorMessage('User not found'));
  });
});
