import { test, expect, confirmDialog } from './fixtures';
import {
  adminClient,
  countBudgets,
  seedBudget,
  seedCategory,
  seedGroup,
  seedTransaction,
} from './db';

/** 一覧・予算の初期表示は今月なので、今日の日付で入れる */
function today(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
}

function thisMonth(): string {
  return `${today().slice(0, 7)}-01`;
}

test.describe('予算', () => {
  test('列1 予算の消化状況が出る', async ({ signedIn, users }) => {
    const category = await seedCategory({ name: '食費' });
    await seedBudget({ categoryId: category, ownerId: users.taro, month: thisMonth(), amount: 10000 });
    await seedTransaction({
      categoryId: category,
      ownerId: users.taro,
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
    const category = await seedCategory({ name: '食費' });
    await seedBudget({ categoryId: category, ownerId: users.taro, month: thisMonth(), amount: 1000 });
    await seedTransaction({
      categoryId: category,
      ownerId: users.taro,
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

  test('列14 ホームでは同じカテゴリでも共有範囲ごとに予算の行を分ける', async ({
    signedIn,
    users,
  }) => {
    // カテゴリは全ユーザー共通なので、夫婦の食費と個人の食費が同じ id を指す。
    // 行を畳むと枠が上書きし合い、実績も範囲をまたいで足し込まれる
    const group = await seedGroup(users);
    const category = await seedCategory({ name: '食費' });
    await seedBudget({ categoryId: category, ownerId: users.taro, month: thisMonth(), amount: 10000 });
    await seedBudget({ categoryId: category, shareGroupId: group, month: thisMonth(), amount: 50000 });
    await seedTransaction({
      categoryId: category,
      ownerId: users.taro,
      payerId: users.taro,
      createdBy: users.taro,
      occurredOn: today(),
      amount: 3000,
      splits: [{ userId: users.taro, amount: 3000 }],
    });
    await seedTransaction({
      categoryId: category,
      shareGroupId: group,
      payerId: users.taro,
      createdBy: users.taro,
      occurredOn: today(),
      amount: 20000,
      splits: [
        { userId: users.taro, amount: 10000 },
        { userId: users.hana, amount: 10000 },
      ],
    });

    await signedIn.goto('/');
    const 個人 = signedIn.getByText('3,000 / 10,000');
    const 夫婦 = signedIn.getByText('20,000 / 50,000');
    await expect(個人).toBeVisible();
    await expect(夫婦).toBeVisible();
  });

  test('列5 収入カテゴリに予算は置けない', async ({ signedIn }) => {
    const category = await seedCategory({ name: '給与', kind: 'income' });

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
    const category = await seedCategory({ name: '食費' });
    await seedBudget({ categoryId: category, ownerId: users.taro, month: thisMonth(), amount: 10000 });

    await signedIn.goto('/budget');
    // 読み込みが終わってから触る。終わる前に入れると読み込みが上書きしてしまう
    await expect(signedIn.getByLabel('食費の予算')).toHaveValue('10000');
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

  test('読み込みが終わるまで予算の入力欄を出さない', async ({ signedIn, users }) => {
    const category = await seedCategory({ name: '食費' });
    await seedBudget({ categoryId: category, ownerId: users.taro, month: thisMonth(), amount: 10000 });

    // 予算の取得を止めておく。空の入力欄を先に出すと、値が届いた時点で入力欄が
    // 作り直され、その間に打ち込んだ内容が黙って消える
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await signedIn.route('**/rest/v1/budgets*', async (route) => {
      await held;
      await route.continue();
    });

    await signedIn.goto('/budget');
    await expect(signedIn.getByText('読み込んでいます…')).toBeVisible();
    await expect(signedIn.getByLabel('食費の予算')).toHaveCount(0);

    release();
    await expect(signedIn.getByLabel('食費の予算')).toHaveValue('10000');
  });

  test('列9 前月の予算を複製できる', async ({ signedIn, users }) => {
    const category = await seedCategory({ name: '食費' });
    const previous = new Date(`${thisMonth()}T00:00:00Z`);
    previous.setUTCMonth(previous.getUTCMonth() - 1);
    await seedBudget({ categoryId: category, ownerId: users.taro, month: previous.toISOString().slice(0, 10), amount: 8000 });

    await signedIn.goto('/budget');
    await expect(signedIn.getByLabel('食費の予算')).toHaveValue('');
    await signedIn.getByRole('button', { name: '前月の予算を複製' }).click();

    await expect(signedIn.getByLabel('食費の予算')).toHaveValue('8000');
    expect(await countBudgets(category)).toBe(2);
  });

  test('列10 カテゴリを消すと予算も消える', async ({ signedIn, users }) => {
    const category = await seedCategory({ name: '食費' });
    await seedBudget({ categoryId: category, ownerId: users.taro, month: thisMonth(), amount: 10000 });

    await signedIn.goto('/categories');
    await signedIn.getByRole('button', { name: '削除' }).click();
    await confirmDialog(signedIn);
    await expect(signedIn.getByLabel('食費の名前')).toHaveCount(0);

    // 未分類には移らず、そのまま消える
    expect(await countBudgets(category)).toBe(0);
    const { count } = await adminClient()
      .from('budgets')
      .select('id', { count: 'exact', head: true });
    expect(count).toBe(0);
  });
  test('列12・列13 予算は大分類に置き、実績は小分類を含む', async ({ signedIn, users }) => {
    const parent = await seedCategory({ name: '食費' });
    const child = await seedCategory({ name: '外食', parentId: parent });
    await seedBudget({ categoryId: parent, ownerId: users.taro, month: thisMonth(), amount: 10000 });
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

    await signedIn.goto('/budget');

    // 小分類は予算の行として出ない
    await expect(signedIn.getByLabel('外食の予算')).toHaveCount(0);
    const row = signedIn.getByRole('row').filter({ hasText: '食費' });
    // 実績は 2,000 + 3,000、残額は 5,000
    await expect(row).toContainText('5,000');
    // 小分類ごとの実績を内訳として出す
    await expect(row).toContainText('外食');
    await expect(row).toContainText('3,000');

    // DB も小分類への予算を拒む
    const { error } = await adminClient()
      .from('budgets')
      .insert({ category_id: child, month: thisMonth(), amount: 1000 });
    expect(error).not.toBeNull();
  });
});
