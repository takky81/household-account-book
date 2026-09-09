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
    const category = await seedCategory({ name: '家賃' });
    await seedTransaction({
      categoryId: category,
      shareGroupId: group,
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
    expect(text).toContain('日付,収支,共有範囲,カテゴリ,小分類,金額,支払者,負担,備考');
    // 負担は表示名の順に並ぶ（読み込んだ順は決まらない）。小分類の無い取引は空欄
    expect(text).toContain('2026-09-01,支出,夫婦,家賃,,1000,共用,hana:500;taro:500,九月分');
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
      '日付,収支,共有範囲,カテゴリ,小分類,金額,支払者,負担,備考',
    );
  });
  test('列11・列12 小分類の列が出る', async ({ signedIn, users }) => {
    const parent = await seedCategory({ name: '食費' });
    const child = await seedCategory({ name: '外食', parentId: parent });
    await seedTransaction({
      categoryId: child,
      ownerId: users.taro,
      payerId: users.taro,
      createdBy: users.taro,
      occurredOn: '2026-09-01',
      amount: 780,
      memo: '昼食',
      splits: [{ userId: users.taro, amount: 780 }],
    });

    await signedIn.goto('/export');
    const transactions = await downloadCsv(signedIn);
    expect(transactions).toContain('日付,収支,共有範囲,カテゴリ,小分類,金額,支払者,負担,備考');
    expect(transactions).toContain('2026-09-01,支出,個人,食費,外食,780,taro,taro:780,昼食');

    await signedIn.getByRole('button', { name: 'カテゴリ', exact: true }).click();
    const categories = await downloadCsv(signedIn);
    // カテゴリ CSV は共有範囲の列を持たない（§4.3）
    expect(categories).toContain('収支,カテゴリ,小分類,色,表示順,未分類,アーカイブ済み');
    expect(categories).toContain('支出,食費,外食,');
  });
});
