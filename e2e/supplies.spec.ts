import { confirmDialog, expect, signIn, test } from './fixtures';
import { HANA } from './env';

test.describe('不足物資', () => {
  test('列3 ログイン利用者どうしで追加・購入済み・削除を共有する', async ({
    signedIn,
    browser,
  }) => {
    await signedIn.goto('/supplies');
    await expect(signedIn.getByText('不足している物資はありません')).toBeVisible();

    await signedIn.getByLabel('不足物資を追加').fill('牛乳');
    await signedIn.getByRole('button', { name: '追加' }).click();
    await expect(signedIn.getByText('残り 1件')).toBeVisible();

    await signedIn.goto('/');
    await expect(
      signedIn.getByRole('link', { name: '不足物資が1件あります。編集する' }),
    ).toBeVisible();

    const hanaContext = await browser.newContext();
    const hana = await hanaContext.newPage();
    await signIn(hana, HANA);
    await hana.goto('/supplies');
    await expect(hana.getByText('牛乳')).toBeVisible();
    await hana.getByRole('button', { name: '牛乳を購入済みにする' }).click();
    await expect(hana.getByText('残り 0件')).toBeVisible();

    await signedIn.reload();
    await expect(
      signedIn.getByRole('link', { name: '不足物資はありません。編集する' }),
    ).toBeVisible();

    await hana.getByRole('button', { name: '牛乳を削除' }).click();
    await confirmDialog(hana);
    await expect(hana.getByText('不足している物資はありません')).toBeVisible();
    await hanaContext.close();
  });
});
