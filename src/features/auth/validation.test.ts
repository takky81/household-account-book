import { describe, it, expect } from 'vitest';
import {
  LOGIN_FAILED,
  signInErrorMessage,
  validateCredentials,
  validatePasswordChange,
} from './validation';

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

describe('validatePasswordChange', () => {
  it('列11 8文字未満のパスワードを弾く', () => {
    expect(validatePasswordChange('e2epassword', 'short7c', 'short7c')).toEqual({
      ok: false,
      message: '新しいパスワードは8文字以上にしてください',
    });
  });

  it('列11 現在のパスワードが空なら送信しない', () => {
    expect(validatePasswordChange('', 'newpassword', 'newpassword')).toEqual({
      ok: false,
      message: '現在のパスワードを入力してください',
    });
  });

  it('列12 確認用が一致しなければ送信しない', () => {
    expect(validatePasswordChange('e2epassword', 'newpassword', 'newpassward')).toEqual({
      ok: false,
      message: '確認用のパスワードが一致しません',
    });
  });

  it('列13 今と同じパスワードは送信しない', () => {
    expect(validatePasswordChange('e2epassword', 'e2epassword', 'e2epassword')).toEqual({
      ok: false,
      message: '新しいパスワードが今のものと同じです',
    });
  });

  it('列9 整っていれば送信する', () => {
    expect(validatePasswordChange('e2epassword', 'newpassword', 'newpassword')).toEqual({
      ok: true,
    });
  });

  it('列11 境界。ちょうど8文字は通る', () => {
    expect(validatePasswordChange('e2epassword', '12345678', '12345678')).toEqual({ ok: true });
    expect(validatePasswordChange('e2epassword', '1234567', '1234567').ok).toBe(false);
  });
});
