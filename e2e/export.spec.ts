import { readFileSync } from 'node:fs';
import { test, expect, type Page } from './fixtures';
import { seedCategory, seedGroup, seedTransaction } from './db';

/** 書き出しボタンを押して、落ちてきたファイルの中身を返す。 */
async function downloadCsv(page: Page): Promise<string> {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '書き出す' }).click();
  const download = await downloading;
  return readFileSync(await download.path(), 'utf8');
}

test.describe('CSVエクスポート', () => {
  test('列1・列3・列5 取引を書き出すと負担と共用払いが出る', async ({ signedIn, users }) => {
    const group = await seedGroup(users);
    const category = await seedCategory({ shareGroupId: group, name: '家賃' });
    await seedTransaction({
      categoryId: category,
      payerId: null,
      createdBy: users.taro,
      occurredOn: '2026-09-01',
      amount: 1000,
      memo: '九月分',
      splits: [
        { userId: users.taro, amount: 500 },
        { userId: users.hana, amount: 500 },
      ],
    });

    await signedIn.goto('/export');
    const text = await downloadCsv(signedIn);

    expect(text.startsWith('﻿')).toBe(true);
    expect(text).toContain('\r\n');
    expect(text).toContain('日付,収支,共有範囲,カテゴリ,金額,支払者,負担,備考');
    expect(text).toContain('2026-09-01,支出,夫婦,家賃,1000,共用,taro:500;hana:500,九月分');
  });

  test('列9 カテゴリの書き出しでは期間を選べない', async ({ signedIn, users }) => {
    void users;
    await signedIn.goto('/export');
    await expect(signedIn.getByRole('button', { name: '全期間' })).toBeVisible();

    await signedIn.getByRole('button', { name: 'カテゴリ', exact: true }).click();
    await expect(signedIn.getByText('期間の指定なし')).toBeVisible();
    await expect(signedIn.getByRole('button', { name: '全期間' })).toHaveCount(0);
  });

  test('列10 取引が1件も無くてもヘッダだけのファイルが出る', async ({ signedIn, users }) => {
    void users;
    await signedIn.goto('/export');
    const text = await downloadCsv(signedIn);

    expect(text.replace('﻿', '').trim()).toBe(
      '日付,収支,共有範囲,カテゴリ,金額,支払者,負担,備考',
    );
  });
});
