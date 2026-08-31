import { test, expect } from './fixtures';
import { adminClient, seedCategory, seedGroup, seedTransaction, systemCategoryOf } from './db';

async function splitsOf(transactionId: string): Promise<{ user_id: string; amount: number }[]> {
  const { data, error } = await adminClient()
    .from('transaction_splits')
    .select('user_id, amount')
    .eq('transaction_id', transactionId);
  if (error !== null) throw error;
  return data as { user_id: string; amount: number }[];
}

async function latestTransaction(): Promise<{ id: string; amount: number; memo: string }> {
  const { data, error } = await adminClient()
    .from('transactions')
    .select('id, amount, memo')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (error !== null) throw error;
  return data as { id: string; amount: number; memo: string };
}

/** 一覧の初期表示は今月なので、今日の日付で入れる */
function today(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
}

test.describe('取引の入力と編集', () => {
  test('列1 共有カテゴリの取引を入力すると既定割合で按分される', async ({ signedIn, users }) => {
    const group = await seedGroup(users);
    await seedCategory({ shareGroupId: group, name: '家賃' });

    await signedIn.goto('/new');
    await signedIn.getByLabel('カテゴリ').selectOption({ label: '夫婦 / 家賃' });
    await signedIn.getByLabel('金額').fill('1001');
    await signedIn.getByRole('button', { name: '保存', exact: true }).click();

    await expect(signedIn.getByRole('heading', { name: '取引一覧' })).toBeVisible();
    const tx = await latestTransaction();
    const splits = await splitsOf(tx.id);
    expect(splits.map((s) => s.amount).sort((a, b) => b - a)).toEqual([501, 500]);
  });

  test('列3 個人カテゴリの取引は本人1行の負担になる', async ({ signedIn, users }) => {
    await seedCategory({ ownerId: users.taro, name: '食費' });

    await signedIn.goto('/new');
    await signedIn.getByLabel('カテゴリ').selectOption({ label: '個人 / 食費' });
    await signedIn.getByLabel('金額').fill('780');
    await signedIn.getByRole('button', { name: '保存', exact: true }).click();

    await expect(signedIn.getByRole('heading', { name: '取引一覧' })).toBeVisible();
    const tx = await latestTransaction();
    const splits = await splitsOf(tx.id);
    expect(splits).toEqual([{ user_id: users.taro, amount: 780 }]);
  });

  test('列7 負担を手で分けるとその通りに保存される', async ({ signedIn, users }) => {
    const group = await seedGroup(users);
    await seedCategory({ shareGroupId: group, name: '家賃' });

    await signedIn.goto('/new');
    await signedIn.getByLabel('カテゴリ').selectOption({ label: '夫婦 / 家賃' });
    await signedIn.getByLabel('金額').fill('1000');
    await signedIn.getByLabel('taroの負担').fill('700');
    await signedIn.getByLabel('hanaの負担').fill('300');
    await signedIn.getByRole('button', { name: '保存', exact: true }).click();

    await expect(signedIn.getByRole('heading', { name: '取引一覧' })).toBeVisible();
    const tx = await latestTransaction();
    const splits = await splitsOf(tx.id);
    expect(splits.find((s) => s.user_id === users.taro)?.amount).toBe(700);
    expect(splits.find((s) => s.user_id === users.hana)?.amount).toBe(300);

    const { data } = await adminClient()
      .from('transactions')
      .select('splits_are_manual')
      .eq('id', tx.id)
      .single();
    expect((data as { splits_are_manual: boolean }).splits_are_manual).toBe(true);
  });

  test('列8 負担の合計が合わないと保存できない', async ({ signedIn, users }) => {
    const group = await seedGroup(users);
    await seedCategory({ shareGroupId: group, name: '家賃' });

    await signedIn.goto('/new');
    await signedIn.getByLabel('カテゴリ').selectOption({ label: '夫婦 / 家賃' });
    await signedIn.getByLabel('金額').fill('1000');
    await signedIn.getByLabel('taroの負担').fill('100');
    await signedIn.getByRole('button', { name: '保存', exact: true }).click();

    await expect(signedIn.getByRole('alert')).toContainText('一致しません');
    const { count } = await adminClient()
      .from('transactions')
      .select('id', { count: 'exact', head: true });
    expect(count).toBe(0);
  });

  test('列11 脱退した人が支払者の取引でも備考を直せる', async ({ signedIn, users }) => {
    const group = await seedGroup(users);
    const category = await seedCategory({ shareGroupId: group, name: '家賃' });
    const id = await seedTransaction({
      categoryId: category,
      payerId: users.hana,
      createdBy: users.taro,
      occurredOn: '2026-08-31',
      amount: 1000,
      memo: '前の備考',
      splits: [
        { userId: users.taro, amount: 500 },
        { userId: users.hana, amount: 500 },
      ],
    });
    // はなこ を外す。過去の取引はそのまま残る（§3.3）
    const { error } = await adminClient()
      .from('share_group_members')
      .delete()
      .eq('share_group_id', group)
      .eq('user_id', users.hana);
    if (error !== null) throw error;

    await signedIn.goto(`/transactions/${id}/edit`);
    // 読み込みが終わってから触る。終わる前に入れると読み込みが上書きしてしまう
    await expect(signedIn.getByLabel('備考')).toHaveValue('前の備考');
    await signedIn.getByLabel('備考').fill('直した備考');
    await signedIn.getByRole('button', { name: '保存', exact: true }).click();

    await expect(signedIn.getByRole('heading', { name: '取引一覧' })).toBeVisible();
    const { data } = await adminClient().from('transactions').select('memo').eq('id', id).single();
    expect((data as { memo: string }).memo).toBe('直した備考');
  });

  test('列12 取引を削除すると負担も消える', async ({ signedIn, users }) => {
    const category = await systemCategoryOf(users.taro, 'expense');
    const id = await seedTransaction({
      categoryId: category,
      payerId: users.taro,
      createdBy: users.taro,
      occurredOn: today(),
      amount: 500,
      memo: '消す取引',
      splits: [{ userId: users.taro, amount: 500 }],
    });

    await signedIn.goto('/transactions');
    await expect(signedIn.getByText('消す取引')).toBeVisible();
    await signedIn.getByRole('button', { name: '削除' }).click();

    await expect(signedIn.getByText('取引がありません')).toBeVisible();
    const splits = await splitsOf(id);
    expect(splits).toEqual([]);
  });

  test('列13 保存して続けて入力すると日付とカテゴリが残り金額が空になる', async ({
    signedIn,
    users,
  }) => {
    await seedCategory({ ownerId: users.taro, name: '食費' });

    await signedIn.goto('/new');
    await signedIn.getByLabel('カテゴリ').selectOption({ label: '個人 / 食費' });
    await signedIn.getByLabel('金額').fill('780');
    await signedIn.getByLabel('備考').fill('昼食');
    await signedIn.getByRole('button', { name: '保存して続けて入力' }).click();

    await expect(signedIn.getByText('保存しました')).toBeVisible();
    await expect(signedIn.getByLabel('金額')).toHaveValue('');
    await expect(signedIn.getByLabel('備考')).toHaveValue('');
    await expect(signedIn.getByLabel('カテゴリ')).not.toHaveValue('');
  });
});
