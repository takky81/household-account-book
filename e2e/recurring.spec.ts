import { test, expect, signIn } from './fixtures';
import {
  archiveCategory,
  countRecurringPostings,
  countTransactions,
  deleteTransactionsOf,
  seedCategory,
  seedForeignGroup,
  seedGroup,
  seedRecurringRule,
} from './db';

/** 対象月は Asia/Tokyo で決まる（§5.3）。支払日1日なら今月ぶんは必ず期日を過ぎている */
function today(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
}

function monthKey(diff = 0): string {
  const [year, month] = today().slice(0, 7).split('-').map(Number) as [number, number];
  const total = year * 12 + (month - 1) + diff;
  const y = Math.floor(total / 12);
  return `${y}-${String(total - y * 12 + 1).padStart(2, '0')}`;
}

test.describe('定期登録', () => {
  test('列1 起動時に今月の家賃が登録される', async ({ page, users }) => {
    const group = await seedGroup(users);
    const category = await seedCategory({ name: '家賃' });
    await seedRecurringRule({
      categoryId: category,
      shareGroupId: group,
      createdBy: users.taro,
      payerId: users.taro,
      amount: 120000,
      dayOfMonth: 1,
      startMonth: monthKey(),
      memo: '家賃',
    });

    await signIn(page);

    await expect(page.getByTestId('recurring-notice')).toContainText('1件を登録しました');
    await page.goto('/transactions');
    await expect(page.getByText('家賃').first()).toBeVisible();
    expect(await countTransactions(category)).toBe(1);
  });

  test('列9 数ヶ月開かなくても遡って登録される', async ({ page, users }) => {
    const group = await seedGroup(users);
    const category = await seedCategory({ name: '家賃' });
    await seedRecurringRule({
      categoryId: category,
      shareGroupId: group,
      createdBy: users.taro,
      payerId: users.taro,
      amount: 120000,
      dayOfMonth: 1,
      startMonth: monthKey(-2),
    });

    await signIn(page);

    await expect(page.getByTestId('recurring-notice')).toContainText('3件を登録しました');
    expect(await countTransactions(category)).toBe(3);
  });

  test('列3 二度開いても取引は1件のまま', async ({ page, users }) => {
    const category = await seedCategory({ name: 'サブスク' });
    await seedRecurringRule({
      categoryId: category,
      ownerId: users.taro,
      createdBy: users.taro,
      payerId: users.taro,
      amount: 980,
      dayOfMonth: 1,
      startMonth: monthKey(),
    });

    await signIn(page);
    await expect(page.getByTestId('recurring-notice')).toContainText('1件を登録しました');

    await page.reload();
    // 2回目は作るものが無いので通知そのものが出ない
    await expect(page.getByRole('link', { name: '＋ 取引を入力' })).toBeVisible();
    await expect(page.getByTestId('recurring-notice')).toHaveCount(0);
    expect(await countTransactions(category)).toBe(1);
  });

  test('列4 消した生成分は復活しない', async ({ page, users }) => {
    const category = await seedCategory({ name: 'サブスク' });
    const rule = await seedRecurringRule({
      categoryId: category,
      ownerId: users.taro,
      createdBy: users.taro,
      payerId: users.taro,
      amount: 980,
      dayOfMonth: 1,
      startMonth: monthKey(),
    });

    await signIn(page);
    expect(await countTransactions(category)).toBe(1);

    // 意図して消したものが、次に開いたときに黙って戻ってはいけない（§3.9）
    await deleteTransactionsOf(category);
    await page.reload();
    await expect(page.getByRole('link', { name: '＋ 取引を入力' })).toBeVisible();

    expect(await countTransactions(category)).toBe(0);
    expect(await countRecurringPostings(rule)).toBe(1);
  });

  test('列12 アーカイブ済みカテゴリのルールは警告になる', async ({ page, users }) => {
    const category = await seedCategory({ name: '旧サブスク' });
    await seedRecurringRule({
      categoryId: category,
      ownerId: users.taro,
      createdBy: users.taro,
      payerId: users.taro,
      amount: 500,
      dayOfMonth: 1,
      startMonth: monthKey(),
    });
    await archiveCategory(category);

    await signIn(page);
    expect(await countTransactions(category)).toBe(0);

    await page.goto('/recurring');
    await expect(page.getByRole('alert')).toContainText('アーカイブ');
  });

  test('列16 設定画面から手で実行できる', async ({ signedIn, users }) => {
    // 画面を開いたあとに足したルール。起動時の実行はもう終わっているので、
    // 手で実行しない限り登録されない
    await signedIn.goto('/settings');
    const run = signedIn.getByRole('button', { name: '定期登録を今すぐ実行' });
    // 画面が出た時点で起動時の実行は終わっている（終わるまで画面を出さない）
    await expect(run).toBeVisible();

    const category = await seedCategory({ name: '保険' });
    await seedRecurringRule({
      categoryId: category,
      ownerId: users.taro,
      createdBy: users.taro,
      payerId: users.taro,
      amount: 3000,
      dayOfMonth: 1,
      startMonth: monthKey(),
    });
    expect(await countTransactions(category)).toBe(0);

    await run.click();

    await expect(signedIn.getByTestId('recurring-run')).toContainText('1件を登録しました');
    expect(await countTransactions(category)).toBe(1);
  });

  test('列1 家賃のルールを登録できる', async ({ signedIn, users }) => {
    await seedGroup(users);
    await seedCategory({ name: '家賃' });

    await signedIn.goto('/recurring');
    await signedIn.getByRole('button', { name: '＋ ルールを追加' }).click();
    await signedIn.getByRole('group', { name: '共有範囲' })
      .getByRole('button', { name: '夫婦' })
      .click();
    await signedIn.getByLabel('カテゴリ').selectOption({ label: '家賃' });
    await signedIn.getByLabel('金額').fill('120000');
    await signedIn.getByLabel('支払日').fill('27');
    await signedIn.getByLabel('備考').fill('家賃');
    await signedIn.getByRole('button', { name: '保存' }).click();

    const row = signedIn.getByTestId('rule');
    await expect(row).toContainText('家賃');
    await expect(row).toContainText('120,000');
    await expect(row).toContainText('毎月27日');
  });

  test('列2 負担を手で決めたルールを登録できる', async ({ signedIn, users }) => {
    await seedGroup(users);
    await seedCategory({ name: '家賃' });

    await signedIn.goto('/recurring');
    await signedIn.getByRole('button', { name: '＋ ルールを追加' }).click();
    await signedIn.getByRole('group', { name: '共有範囲' })
      .getByRole('button', { name: '夫婦' })
      .click();
    await signedIn.getByLabel('カテゴリ').selectOption({ label: '家賃' });
    await signedIn.getByLabel('金額').fill('100000');
    await signedIn.getByLabel('taroの負担').fill('70000');
    await signedIn.getByLabel('hanaの負担').fill('30000');
    await signedIn.getByRole('button', { name: '保存' }).click();

    await expect(signedIn.getByTestId('rule')).toContainText('100,000');

    // 開き直しても手で決めた雛形のまま
    await signedIn.getByRole('button', { name: '編集' }).click();
    await expect(signedIn.getByLabel('taroの負担')).toHaveValue('70000');
  });

  test('列3 負担の合計が合わないと保存できない', async ({ signedIn, users }) => {
    await seedGroup(users);
    await seedCategory({ name: '家賃' });

    await signedIn.goto('/recurring');
    await signedIn.getByRole('button', { name: '＋ ルールを追加' }).click();
    await signedIn.getByRole('group', { name: '共有範囲' })
      .getByRole('button', { name: '夫婦' })
      .click();
    await signedIn.getByLabel('カテゴリ').selectOption({ label: '家賃' });
    await signedIn.getByLabel('金額').fill('100000');
    await signedIn.getByLabel('taroの負担').fill('70000');
    await signedIn.getByLabel('hanaの負担').fill('20000');
    await signedIn.getByRole('button', { name: '保存' }).click();

    await expect(signedIn.getByRole('alert')).toContainText('一致しません');
    await expect(signedIn.getByTestId('rule')).toHaveCount(0);
  });

  test('列7 参照できない共有範囲は選べない', async ({ signedIn, users }) => {
    // カテゴリは全員共通なので、隠れるのは共有範囲の方（§2.4）
    await seedCategory({ name: '光熱費' });
    await seedGroup(users, '夫婦');
    await seedForeignGroup('他人だけのグループ', users.hana);

    await signedIn.goto('/recurring');
    await signedIn.getByRole('button', { name: '＋ ルールを追加' }).click();

    await expect(signedIn.getByLabel('カテゴリ').locator('option').filter({ hasText: '光熱費' })).toHaveCount(1);
    const scopes = signedIn.getByRole('group', { name: '共有範囲' });
    await expect(scopes.getByRole('button', { name: '個人' })).toHaveCount(1);
    await expect(scopes.getByRole('button', { name: '夫婦' })).toHaveCount(1);
    await expect(scopes.getByRole('button', { name: '他人だけのグループ' })).toHaveCount(0);
  });

  test('列10 一時停止したルールは生成されない', async ({ page, users }) => {
    const category = await seedCategory({ name: 'サブスク' });
    await seedRecurringRule({
      categoryId: category,
      ownerId: users.taro,
      createdBy: users.taro,
      payerId: users.taro,
      amount: 980,
      dayOfMonth: 1,
      // 来月からのルール。起動時の実行では何も作らない
      startMonth: monthKey(1),
    });

    await signIn(page);
    await page.goto('/recurring');
    await page.getByRole('button', { name: '一時停止' }).click();

    await expect(page.getByTestId('rule')).toContainText('一時停止中');
    expect(await countTransactions(category)).toBe(0);
  });
});
