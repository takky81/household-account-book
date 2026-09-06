import { test, expect, signIn, type Page } from './fixtures';
import { setPassword } from './db';
import { TARO } from './env';

/** 変更のテストで使う新しいパスワード。終わったら元に戻す。 */
const NEW_PASSWORD = 'e2enewpassword';

/** 設定画面のパスワード欄を埋めて変更を押す。 */
async function submitPasswordChange(
  page: Page,
  input: { current: string; next: string; confirm?: string },
): Promise<void> {
  await page.goto('/settings');
  await page.getByLabel('現在のパスワード').fill(input.current);
  await page.getByLabel('新しいパスワード', { exact: true }).fill(input.next);
  await page.getByLabel('新しいパスワード（確認）').fill(input.confirm ?? input.next);
  await page.getByRole('button', { name: 'パスワードを変更' }).click();
}

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

test.describe('パスワードの変更', () => {
  // 途中で失敗しても後続のテストが元のパスワードで入れるようにする
  test.afterEach(async () => {
    await setPassword(TARO.email, TARO.password);
  });

  test('列9 パスワードを変更できる', async ({ signedIn }) => {
    await submitPasswordChange(signedIn, { current: TARO.password, next: NEW_PASSWORD });
    await expect(signedIn.getByRole('status')).toHaveText('パスワードを変更しました');
    // 入力欄に残さない
    await expect(signedIn.getByLabel('現在のパスワード')).toHaveValue('');
  });

  test('列10 現在のパスワードが違うと変更できない', async ({ signedIn }) => {
    await submitPasswordChange(signedIn, { current: 'ちがうパスワード', next: NEW_PASSWORD });
    await expect(signedIn.getByRole('alert')).toHaveText('現在のパスワードが違います');
    await expect(signedIn.getByRole('status')).toHaveCount(0);
    // 変わっていないので、元のパスワードでまだ入れる
    await signedIn.getByRole('button', { name: 'ログアウト' }).click();
    await signIn(signedIn);
  });

  test('列11 短いパスワードは送信しない', async ({ signedIn }) => {
    await submitPasswordChange(signedIn, { current: TARO.password, next: 'short7c' });
    await expect(signedIn.getByRole('alert')).toHaveText(
      '新しいパスワードは8文字以上にしてください',
    );
    await expect(signedIn.getByRole('status')).toHaveCount(0);
  });

  test('列12 確認用が一致しないと送信しない', async ({ signedIn }) => {
    await submitPasswordChange(signedIn, {
      current: TARO.password,
      next: NEW_PASSWORD,
      confirm: `${NEW_PASSWORD}x`,
    });
    await expect(signedIn.getByRole('alert')).toHaveText('確認用のパスワードが一致しません');
    await expect(signedIn.getByRole('status')).toHaveCount(0);
  });

  test('列14 変更後は新しいパスワードでログインできる', async ({ signedIn }) => {
    await submitPasswordChange(signedIn, { current: TARO.password, next: NEW_PASSWORD });
    await expect(signedIn.getByRole('status')).toHaveText('パスワードを変更しました');
    await signedIn.getByRole('button', { name: 'ログアウト' }).click();
    await signIn(signedIn, { email: TARO.email, password: NEW_PASSWORD });
  });
});
