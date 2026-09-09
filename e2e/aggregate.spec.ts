import { test, expect } from './fixtures';
import { seedCategory, seedGroup, seedTransaction } from './db';

/** 集計の初期表示は今月なので、今日の日付で入れる */
function today(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
}

test.describe('集計', () => {
  test('列1・列2 対象範囲と集計基準で見える金額が変わる', async ({ signedIn, users }) => {
    const group = await seedGroup(users);
    const shared = await seedCategory({ name: '家賃' });
    const own = await seedCategory({ name: '食費' });
    // はなこ が払い、折半した共有の支出
    await seedTransaction({
      categoryId: shared,
      shareGroupId: group,
      payerId: users.hana,
      createdBy: users.taro,
      occurredOn: today(),
      amount: 1000,
      splits: [
        { userId: users.taro, amount: 500 },
        { userId: users.hana, amount: 500 },
      ],
    });
    await seedTransaction({
      categoryId: own,
      ownerId: users.taro,
      payerId: users.taro,
      createdBy: users.taro,
      occurredOn: today(),
      amount: 300,
      splits: [{ userId: users.taro, amount: 300 }],
    });

    await signedIn.goto('/aggregate');

    // 自分に関わるすべて × 負担額 = 500 + 300
    await expect(signedIn.getByTestId('expense')).toHaveText('800');

    // 自分に関わるすべて × 支払額 = 自分が払った 300 だけ
    await signedIn.getByRole('button', { name: '支払額' }).click();
    await expect(signedIn.getByTestId('expense')).toHaveText('300');

    // 夫婦 × 支払額 = グループの支出 1000
    await signedIn.getByRole('button', { name: '夫婦' }).click();
    await expect(signedIn.getByTestId('expense')).toHaveText('1,000');

    // グループを見ているときは人別の内訳が出る
    const byUser = signedIn.getByRole('listitem').filter({ hasText: 'hana' });
    await expect(byUser).toContainText('1,000');

    // 個人のみ × 負担額 = 300
    await signedIn.getByRole('button', { name: '個人のみ' }).click();
    await signedIn.getByRole('button', { name: '負担額' }).click();
    await expect(signedIn.getByTestId('expense')).toHaveText('300');
  });

  test('列11 取引のない月は内訳が空になる', async ({ signedIn }) => {
    await seedCategory({ name: '食費' });

    await signedIn.goto('/aggregate');
    await signedIn.getByRole('button', { name: '前の月' }).click();

    await expect(signedIn.getByText('この月の取引はありません')).toBeVisible();
    await expect(signedIn.getByTestId('expense')).toHaveText('0');
  });
  test('列12・列13 内訳は大分類で集約し、展開すると小分類が出る', async ({ signedIn, users }) => {
    const parent = await seedCategory({ name: '食費' });
    const child = await seedCategory({ name: '外食', parentId: parent });
    for (const [categoryId, amount] of [
      [parent, 2000],
      [child, 3000],
    ] as const) {
      await seedTransaction({
        categoryId,
        payerId: users.taro,
        createdBy: users.taro,
        occurredOn: today(),
        amount,
        splits: [{ userId: users.taro, amount }],
      });
    }

    await signedIn.goto('/aggregate');

    // 大分類の1行にまとまり、額は配下を含む
    const row = signedIn.getByRole('listitem').filter({ hasText: '食費' });
    await expect(row).toContainText('5,000');
    await expect(signedIn.getByText('外食')).toHaveCount(0);

    // 展開すると小分類と（小分類なし）の内訳が出る
    await signedIn.getByRole('button', { name: '食費の内訳' }).click();
    await expect(signedIn.getByText('外食')).toBeVisible();
    await expect(signedIn.getByText('（小分類なし）')).toBeVisible();
  });
});
