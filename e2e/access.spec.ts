import { test, expect, signIn } from './fixtures';
import { seedCategory, seedGroup, seedTransaction } from './db';
import { HANA, OTHER } from './env';

/** 一覧の初期表示は今月なので、今日の日付で入れる */
function today(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
}

test.describe('アクセス制御', () => {
  test('列1・列2 同じグループの人には共有の取引が見え、個人の取引は見えない', async ({
    page,
    users,
  }) => {
    const group = await seedGroup(users);
    const shared = await seedCategory({ name: '家賃' });
    const own = await seedCategory({ name: '食費' });
    await seedTransaction({
      categoryId: shared,
      shareGroupId: group,
      payerId: users.taro,
      createdBy: users.taro,
      occurredOn: today(),
      amount: 1000,
      memo: '共有の取引',
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
      memo: 'たろうの個人の取引',
      splits: [{ userId: users.taro, amount: 300 }],
    });

    await signIn(page, HANA);
    await page.goto('/transactions');

    await expect(page.getByText('共有の取引')).toBeVisible();
    await expect(page.getByText('たろうの個人の取引')).toHaveCount(0);
  });

  test('列3 属さないグループのカテゴリも取引も見えない', async ({ page, users }) => {
    const group = await seedGroup(users);
    const shared = await seedCategory({ name: '家賃' });
    await seedTransaction({
      categoryId: shared,
      shareGroupId: group,
      payerId: users.taro,
      createdBy: users.taro,
      occurredOn: today(),
      amount: 1000,
      memo: '夫婦の取引',
      splits: [
        { userId: users.taro, amount: 500 },
        { userId: users.hana, amount: 500 },
      ],
    });

    await signIn(page, OTHER);
    await page.goto('/transactions');
    await expect(page.getByText('夫婦の取引')).toHaveCount(0);

    await page.goto('/categories');
    await expect(page.getByLabel('家賃の名前')).toHaveCount(0);
    // 自分の未分類だけが見える
    await expect(page.getByText('（消せない）')).toHaveCount(1);
  });
});
