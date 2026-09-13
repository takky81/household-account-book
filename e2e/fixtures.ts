import { test as base, expect, type Page } from '@playwright/test';
import { ensureUsers, resetData, type TestUsers } from './db';
import { TARO } from './env';

/** ログイン画面から入る。決定表「認証」列1 の経路。 */
export async function signIn(
  page: Page,
  user: { email: string; password: string } = TARO,
): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('メールアドレス').fill(user.email);
  await page.getByLabel('パスワード').fill(user.password);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page.getByRole('link', { name: '＋ 取引を入力' })).toBeVisible();
}

/**
 * 確認ダイアログで消すほうを選ぶ（決定表「表示設定と共通の振る舞い」列9）。
 * 消す操作は必ず1枚はさむので、テストからもここを通す。
 */
export async function confirmDialog(page: Page, label = '削除する'): Promise<void> {
  await page.getByRole('dialog').getByRole('button', { name: label }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/** 各テストを空のデータから始める。 */
export const test = base.extend<{ users: TestUsers; signedIn: Page }>({
  users: async ({}, use) => {
    const users = await ensureUsers();
    await resetData();
    await use(users);
  },
  signedIn: async ({ page, users }, use) => {
    void users;
    await signIn(page);
    await use(page);
  },
});

export { expect };
export type { Page };
