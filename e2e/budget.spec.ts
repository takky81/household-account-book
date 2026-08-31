import { test, expect } from './fixtures';
import { adminClient, countBudgets, seedBudget, seedCategory, seedTransaction } from './db';

/** 一覧・予算の初期表示は今月なので、今日の日付で入れる */
function today(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
}

function thisMonth(): string {
  return `${today().slice(0, 7)}-01`;
}

test.describe('予算', () => {
  test('列1 予算の消化状況が出る', async ({ signedIn, users }) => {
    const category = await seedCategory({ ownerId: users.taro, name: '食費' });
    await seedBudget(category, thisMonth(), 10000);
    await seedTransaction({
      categoryId: category,
      payerId: users.taro,
      createdBy: users.taro,
      occurredOn: today(),
      amount: 3000,
      splits: [{ userId: users.taro, amount: 3000 }],
    });

    await signedIn.goto('/budget');
    const row = signedIn.getByRole('row').filter({ hasText: '食費' });
    await expect(row).toContainText('3,000');
    await expect(row).toContainText('7,000');
  });

  test('列2 予算を超えると超過として出る', async ({ signedIn, users }) => {
    const category = await seedCategory({ ownerId: users.taro, name: '食費' });
    await seedBudget(category, thisMonth(), 1000);
    await seedTransaction({
      categoryId: category,
      payerId: users.taro,
      createdBy: users.taro,
      occurredOn: today(),
      amount: 3000,
      splits: [{ userId: users.taro, amount: 3000 }],
    });

    await signedIn.goto('/budget');
    const row = signedIn.getByRole('row').filter({ hasText: '食費' });
    await expect(row).toContainText('-2,000');
  });

  test('列5 収入カテゴリに予算は置けない', async ({ signedIn, users }) => {
    const category = await seedCategory({ ownerId: users.taro, name: '給与', kind: 'income' });

    await signedIn.goto('/budget');
    // 予算の表には支出カテゴリしか出ない
    await expect(signedIn.getByRole('row').filter({ hasText: '給与' })).toHaveCount(0);

    // DB も収入カテゴリの予算を拒む
    const { error } = await adminClient()
      .from('budgets')
      .insert({ category_id: category, month: thisMonth(), amount: 1000 });
    expect(error).not.toBeNull();
    expect(await countBudgets(category)).toBe(0);
  });

  test('列7 同じ月に入れ直すと上書きになる', async ({ signedIn, users }) => {
    const category = await seedCategory({ ownerId: users.taro, name: '食費' });
    await seedBudget(category, thisMonth(), 10000);

    await signedIn.goto('/budget');
    await signedIn.getByLabel('食費の予算').fill('12000');
    await signedIn.getByLabel('食費の予算').blur();

    await expect
      .poll(async () => {
        const { data } = await adminClient()
          .from('budgets')
          .select('amount')
          .eq('category_id', category)
          .single();
        return (data as { amount: number }).amount;
      })
      .toBe(12000);
    expect(await countBudgets(category)).toBe(1);
  });

  test('列9 前月の予算を複製できる', async ({ signedIn, users }) => {
    const category = await seedCategory({ ownerId: users.taro, name: '食費' });
    const previous = new Date(`${thisMonth()}T00:00:00Z`);
    previous.setUTCMonth(previous.getUTCMonth() - 1);
    await seedBudget(category, previous.toISOString().slice(0, 10), 8000);

    await signedIn.goto('/budget');
    await expect(signedIn.getByLabel('食費の予算')).toHaveValue('');
    await signedIn.getByRole('button', { name: '前月の予算を複製' }).click();

    await expect(signedIn.getByLabel('食費の予算')).toHaveValue('8000');
    expect(await countBudgets(category)).toBe(2);
  });

  test('列10 カテゴリを消すと予算も消える', async ({ signedIn, users }) => {
    const category = await seedCategory({ ownerId: users.taro, name: '食費' });
    await seedBudget(category, thisMonth(), 10000);

    await signedIn.goto('/categories');
    await signedIn.getByRole('button', { name: '削除' }).click();
    await expect(signedIn.getByLabel('食費の名前')).toHaveCount(0);

    // 未分類には移らず、そのまま消える
    expect(await countBudgets(category)).toBe(0);
    const { count } = await adminClient()
      .from('budgets')
      .select('id', { count: 'exact', head: true });
    expect(count).toBe(0);
  });
});
