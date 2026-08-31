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
