import { test, expect } from './fixtures';
import { adminClient, seedCategory, seedGroup, seedTransaction } from './db';

const HEADER = '日付,収支,共有範囲,カテゴリ,金額,支払者,負担,備考';

async function transactions(): Promise<
  { occurred_on: string; amount: number; memo: string; category_id: string }[]
> {
  const { data, error } = await adminClient()
    .from('transactions')
    .select('occurred_on, amount, memo, category_id')
    .order('occurred_on');
  if (error !== null) throw error;
  return data as { occurred_on: string; amount: number; memo: string; category_id: string }[];
}

test.describe('CSVインポート', () => {
  test('列1・列2 負担の有無にかかわらず取り込める', async ({ signedIn, users }) => {
    const group = await seedGroup(users);
    await seedCategory({ shareGroupId: group, name: '家賃' });
    await seedCategory({ ownerId: users.taro, name: '食費' });

    await signedIn.goto('/import');
    await signedIn
      .getByLabel('CSV の中身')
      .fill(
        [
          HEADER,
          '2026-09-01,支出,夫婦,家賃,1000,taro,taro:700;hana:300,九月分',
          '2026-09-02,支出,個人,食費,780,taro,,昼食',
        ].join('\n'),
      );
    await signedIn.getByRole('button', { name: '内容を確かめる' }).click();

    await expect(signedIn.getByTestId('import-summary')).toContainText('成功 2');
    await signedIn.getByRole('button', { name: '2件を取り込む' }).click();

    await expect(signedIn.getByText('2件を取り込みました')).toBeVisible();
    const rows = await transactions();
    expect(rows.map((r) => r.memo)).toEqual(['九月分', '昼食']);

    // 負担を書いた行はその通り、書かなかった行は既定割合
    const { data } = await adminClient()
      .from('transaction_splits')
      .select('amount, transactions!inner(memo)')
      .order('amount');
    const splits = data as unknown as { amount: number; transactions: { memo: string } }[];
    expect(splits.filter((s) => s.transactions.memo === '九月分').map((s) => s.amount)).toEqual([
      300, 700,
    ]);
    expect(splits.filter((s) => s.transactions.memo === '昼食').map((s) => s.amount)).toEqual([780]);
  });

  test('列16 エラー行が混ざっても正しい行だけ取り込む', async ({ signedIn, users }) => {
    await seedCategory({ ownerId: users.taro, name: '食費' });

    await signedIn.goto('/import');
    await signedIn
      .getByLabel('CSV の中身')
      .fill(
        [
          HEADER,
          '2026-09-01,支出,個人,食費,780,taro,,よい行',
          '9月2日,支出,個人,食費,500,taro,,日付が変',
          '2026-09-03,支出,個人,食費,0,taro,,金額が0',
        ].join('\n'),
      );
    await signedIn.getByRole('button', { name: '内容を確かめる' }).click();

    await expect(signedIn.getByTestId('import-summary')).toContainText('成功 1');
    await expect(signedIn.getByTestId('import-summary')).toContainText('エラー 2');
    await signedIn.getByRole('button', { name: '1件を取り込む' }).click();

    await expect(signedIn.getByText('1件を取り込みました')).toBeVisible();
    expect((await transactions()).map((r) => r.memo)).toEqual(['よい行']);
  });

  test('列4 同じ内容の取引は飛ばす', async ({ signedIn, users }) => {
    const category = await seedCategory({ ownerId: users.taro, name: '食費' });
    await seedTransaction({
      categoryId: category,
      payerId: users.taro,
      createdBy: users.taro,
      occurredOn: '2026-09-01',
      amount: 780,
      memo: '昼食',
      splits: [{ userId: users.taro, amount: 780 }],
    });

    await signedIn.goto('/import');
    await signedIn
      .getByLabel('CSV の中身')
      .fill([HEADER, '2026-09-01,支出,個人,食費,780,taro,,昼食'].join('\n'));
    await signedIn.getByRole('button', { name: '内容を確かめる' }).click();

    await expect(signedIn.getByTestId('import-summary')).toContainText('飛ばす 1');
    expect((await transactions()).length).toBe(1);
  });
});
