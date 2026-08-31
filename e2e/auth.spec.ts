import { test, expect, signIn } from './fixtures';
import { TARO } from './env';

test.describe('認証', () => {
  test('列1 ログインできる', async ({ page, users }) => {
    void users;
    await signIn(page);
    await expect(page.getByRole('link', { name: '＋ 取引を入力' })).toBeVisible();
  });

  test('列2 パスワードが違うとログインできない', async ({ page, users }) => {
    void users;
    await page.goto('/login');
    await page.getByLabel('メールアドレス').fill(TARO.email);
    await page.getByLabel('パスワード').fill('ちがうパスワード');
    await page.getByRole('button', { name: 'ログイン' }).click();
    await expect(page.getByRole('alert')).toHaveText('メールアドレスまたはパスワードが違います');
  });

  test('列3 未登録メールでも同じ文言になる', async ({ page, users }) => {
    void users;
    await page.goto('/login');
    await page.getByLabel('メールアドレス').fill('nobody@example.test');
    await page.getByLabel('パスワード').fill('e2epassword');
    await page.getByRole('button', { name: 'ログイン' }).click();
    await expect(page.getByRole('alert')).toHaveText('メールアドレスまたはパスワードが違います');
  });

  test('列4 書式の不正なメールは送信しない', async ({ page, users }) => {
    void users;
    await page.goto('/login');
    await page.getByLabel('メールアドレス').fill('taro');
    await page.getByLabel('パスワード').fill('e2epassword');
    await page.getByRole('button', { name: 'ログイン' }).click();
    await expect(page.getByRole('alert')).toHaveText('メールアドレスの形式が正しくありません');
  });

  test('列5 未ログインでは保護された画面を開けない', async ({ page, users }) => {
    void users;
    await page.goto('/budget');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('button', { name: 'ログイン' })).toBeVisible();
  });

  test('列6 ログイン済みならログイン画面はホームへ送る', async ({ signedIn }) => {
    await signedIn.goto('/login');
    await expect(signedIn).toHaveURL(/\/$/);
    await expect(signedIn.getByRole('link', { name: '＋ 取引を入力' })).toBeVisible();
  });

  test('列7 ログアウトできる', async ({ signedIn }) => {
    await signedIn.goto('/settings');
    await signedIn.getByRole('button', { name: 'ログアウト' }).click();
    await expect(signedIn.getByRole('button', { name: 'ログイン' })).toBeVisible();
  });

  test('列8 サインアップ導線を持たない', async ({ page, users }) => {
    void users;
    await page.goto('/login');
    await expect(page.getByText('登録', { exact: false })).toHaveCount(0);
    await expect(page.getByRole('link')).toHaveCount(0);
  });
});
