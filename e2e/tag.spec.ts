import { test, expect } from './fixtures';
import { seedCategory, seedTag, seedTransaction } from './db';

function today(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
}

test.describe('タグの管理', () => {
  test('列1 追加したタグを取引入力で選べる', async ({ signedIn }) => {
    await seedCategory({ name: '交通費' });
    await signedIn.goto('/tags');
    await signedIn.getByLabel('名前').fill('旅行');
    await signedIn.getByRole('button', { name: '追加' }).click();
    await expect(signedIn.getByLabel('旅行の名前')).toHaveValue('旅行');

    await signedIn.goto('/new');
    await expect(signedIn.getByRole('checkbox', { name: '旅行', exact: true })).toBeVisible();
  });

  test('列2 使用停止すると新規候補から外れ、過去の取引には残る', async ({ signedIn, users }) => {
    const category = await seedCategory({ name: '交通費' });
    const tag = await seedTag('旅行');
    await seedTransaction({
      categoryId: category,
      ownerId: users.taro,
      payerId: users.taro,
      createdBy: users.taro,
      occurredOn: today(),
      amount: 1200,
      splits: [{ userId: users.taro, amount: 1200 }],
      tagIds: [tag],
    });

    await signedIn.goto('/tags');
    await signedIn.getByRole('button', { name: '使用停止' }).click();
    await expect(signedIn.getByRole('button', { name: '再開' })).toBeVisible();

    await signedIn.goto('/new');
    await expect(signedIn.getByRole('checkbox', { name: '旅行', exact: true })).toHaveCount(0);
    await signedIn.goto('/transactions');
    await expect(signedIn.getByText('旅行')).toBeVisible();
  });
});
