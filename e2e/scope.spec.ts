import { test, expect } from './fixtures';
import { adminClient, seedCategory, seedGroup, seedTransaction } from './db';

/**
 * 共有範囲の変更（決定表「共有範囲の変更」）。
 *
 * カテゴリは全ユーザー共通で共有範囲を持たないので、動かすのは取引の側。
 * 経路は「1件を編集して変える」と「一覧でまとめて変える」の2つ（§2.8）。
 */

async function splitsOf(transactionId: string): Promise<{ user_id: string; amount: number }[]> {
  const { data, error } = await adminClient()
    .from('transaction_splits')
    .select('user_id, amount')
    .eq('transaction_id', transactionId);
  if (error !== null) throw error;
  return data as { user_id: string; amount: number }[];
}

async function scopeOf(transactionId: string): Promise<string | null> {
  const { data, error } = await adminClient()
    .from('transactions')
    .select('share_group_id')
    .eq('id', transactionId)
    .single();
  if (error !== null) throw error;
  return (data as { share_group_id: string | null }).share_group_id;
}

/** 一覧の初期表示は今月なので、今日の日付で入れる */
function today(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
}

test.describe('共有範囲の変更', () => {
  test('列12 1件だけならその場で別の共有範囲へ付け替えられる', async ({ signedIn, users }) => {
    const group = await seedGroup(users);
    const own = await seedCategory({ name: '食費' });
    await seedCategory({ name: '外食' });
    const id = await seedTransaction({
      categoryId: own,
      ownerId: users.taro,
      payerId: users.taro,
      createdBy: users.taro,
      occurredOn: '2026-09-01',
      amount: 1000,
      memo: '付け替える取引',
      splits: [{ userId: users.taro, amount: 1000 }],
    });

    await signedIn.goto(`/transactions/${id}/edit`);
    await expect(signedIn.getByLabel('備考')).toHaveValue('付け替える取引');
    await signedIn
      .getByRole('group', { name: '共有範囲' })
      .getByRole('button', { name: '夫婦' })
      .click();
    await signedIn.getByLabel('カテゴリ').selectOption({ label: '外食' });
    // 移動先の既定割合が先に画面へ出る
    await expect(signedIn.getByLabel('taroの負担')).toHaveValue('500');
    await signedIn.getByRole('button', { name: '保存', exact: true }).click();

    await expect(signedIn.getByRole('heading', { name: '取引一覧' })).toBeVisible();
    const { data } = await adminClient()
      .from('transactions')
      .select('share_group_id, categories(name)')
      .eq('id', id)
      .single();
    const moved = data as unknown as {
      share_group_id: string | null;
      categories: { name: string };
    };
    // カテゴリと共有範囲は別々に動く
    expect(moved.categories.name).toBe('外食');
    expect(moved.share_group_id).toBe(group);

    // 負担は移動先の既定割合で作り直される
    const splits = await splitsOf(id);
    expect(splits.map((s) => s.amount).sort()).toEqual([500, 500]);
    expect(splits.map((s) => s.user_id).sort()).toEqual([users.taro, users.hana].sort());
  });

  test('列1・列14 一覧でまとめて共有範囲を変えると負担が作り直される', async ({ signedIn, users }) => {
    const group = await seedGroup(users);
    const category = await seedCategory({ name: '食費' });
    const id = await seedTransaction({
      categoryId: category,
      ownerId: users.taro,
      payerId: users.taro,
      createdBy: users.taro,
      occurredOn: today(),
      amount: 1000,
      memo: 'まとめて移す',
      splits: [{ userId: users.taro, amount: 1000 }],
    });

    await signedIn.goto('/transactions');
    await signedIn.getByLabel('食費 を選ぶ').first().check();
    await signedIn.getByLabel('付け替え先の共有範囲').selectOption({ label: '夫婦' });
    await signedIn.getByRole('button', { name: '共有範囲を付け替える' }).click();

    await expect.poll(() => scopeOf(id)).toBe(group);
    const splits = await splitsOf(id);
    expect(splits.map((s) => s.amount).sort()).toEqual([500, 500]);
  });

  test('列8 他人が負担している取引は個人へ戻せない', async ({ signedIn, users }) => {
    const group = await seedGroup(users);
    const category = await seedCategory({ name: '食費' });
    const id = await seedTransaction({
      categoryId: category,
      shareGroupId: group,
      payerId: users.taro,
      createdBy: users.taro,
      occurredOn: today(),
      amount: 1000,
      memo: '折半の取引',
      splits: [
        { userId: users.taro, amount: 500 },
        { userId: users.hana, amount: 500 },
      ],
    });

    await signedIn.goto('/transactions');
    await signedIn.getByLabel('食費 を選ぶ').first().check();
    await signedIn.getByLabel('付け替え先の共有範囲').selectOption({ label: '個人' });
    await signedIn.getByRole('button', { name: '共有範囲を付け替える' }).click();

    await expect(signedIn.getByRole('alert')).toContainText('負担している取引');
    // 知らせるだけで、まだ移していない
    expect(await scopeOf(id)).toBe(group);
  });

  test('列3・列15 カテゴリの付け替えでは共有範囲も手入力の負担も動かない', async ({
    signedIn,
    users,
  }) => {
    const group = await seedGroup(users);
    const from = await seedCategory({ name: '食費' });
    await seedCategory({ name: '日用品' });
    const id = await seedTransaction({
      categoryId: from,
      shareGroupId: group,
      payerId: users.taro,
      createdBy: users.taro,
      occurredOn: today(),
      amount: 1000,
      memo: '手で直した負担',
      splits: [
        { userId: users.taro, amount: 700 },
        { userId: users.hana, amount: 300 },
      ],
    });
    const { error } = await adminClient()
      .from('transactions')
      .update({ splits_are_manual: true })
      .eq('id', id);
    if (error !== null) throw error;

    await signedIn.goto('/transactions');
    await signedIn.getByLabel('食費 を選ぶ').first().check();
    await signedIn.getByLabel('付け替え先のカテゴリ').selectOption({ label: '日用品' });
    await signedIn.getByRole('button', { name: 'カテゴリを付け替える' }).click();

    await expect
      .poll(async () => {
        const { data } = await adminClient()
          .from('transactions')
          .select('categories(name)')
          .eq('id', id)
          .single();
        return (data as unknown as { categories: { name: string } }).categories.name;
      })
      .toBe('日用品');

    // 共有範囲が動かないので負担は作り直されない
    expect(await scopeOf(id)).toBe(group);
    const splits = await splitsOf(id);
    expect(splits.find((s) => s.user_id === users.taro)?.amount).toBe(700);
  });

  test('列13 カテゴリ画面に共有範囲を変える手立ては無い', async ({ signedIn, users }) => {
    await seedGroup(users);
    const parent = await seedCategory({ name: '食費' });
    await seedCategory({ name: '外食', parentId: parent });

    await signedIn.goto('/categories');
    await expect(signedIn.getByLabel('外食の名前')).toBeVisible();
    // カテゴリは共有範囲を持たないので、移動先を選ぶ手立てそのものが無い
    await expect(signedIn.getByLabel('食費の移動先')).toHaveCount(0);
    await expect(signedIn.getByLabel('外食の移動先')).toHaveCount(0);
  });
});
