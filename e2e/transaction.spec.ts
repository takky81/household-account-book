import { test, expect, confirmDialog } from './fixtures';
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
    await seedGroup(users);
    await seedCategory({ name: '家賃' });

    await signedIn.goto('/new');
    await signedIn.getByRole('group', { name: '共有範囲' })
      .getByRole('button', { name: '夫婦' })
      .click();
    await signedIn.getByLabel('カテゴリ').selectOption({ label: '家賃' });
    await signedIn.getByLabel('金額').fill('1001');
    await signedIn.getByRole('button', { name: '保存', exact: true }).click();

    await expect(signedIn.getByRole('heading', { name: '取引一覧' })).toBeVisible();
    const tx = await latestTransaction();
    const splits = await splitsOf(tx.id);
    expect(splits.map((s) => s.amount).sort((a, b) => b - a)).toEqual([501, 500]);
  });

  test('列3 個人カテゴリの取引は本人1行の負担になる', async ({ signedIn, users }) => {
    await seedCategory({ name: '食費' });

    await signedIn.goto('/new');
    await signedIn.getByLabel('カテゴリ').selectOption({ label: '食費' });
    await signedIn.getByLabel('金額').fill('780');
    await signedIn.getByRole('button', { name: '保存', exact: true }).click();

    await expect(signedIn.getByRole('heading', { name: '取引一覧' })).toBeVisible();
    const tx = await latestTransaction();
    const splits = await splitsOf(tx.id);
    expect(splits).toEqual([{ user_id: users.taro, amount: 780 }]);
  });

  test('列15 個人の共有範囲では負担の入力欄を出さない', async ({ signedIn, users }) => {
    // カテゴリは1件でよい。負担の欄が出るかどうかは共有範囲だけで決まる（§2.4）
    await seedGroup(users);
    await seedCategory({ name: '日用品' });

    await signedIn.goto('/new');
    await signedIn.getByLabel('カテゴリ').selectOption({ label: '日用品' });
    await signedIn.getByLabel('金額').fill('780');
    // 既定は個人なので出ない
    await expect(signedIn.getByLabel('taroの負担')).toHaveCount(0);

    // 共有範囲を変えれば出る。カテゴリは選び直さない
    await signedIn.getByRole('group', { name: '共有範囲' })
      .getByRole('button', { name: '夫婦' })
      .click();
    await expect(signedIn.getByLabel('taroの負担')).toHaveValue('390');
  });

  test('列7 負担を手で分けるとその通りに保存される', async ({ signedIn, users }) => {
    await seedGroup(users);
    await seedCategory({ name: '家賃' });

    await signedIn.goto('/new');
    await signedIn.getByRole('group', { name: '共有範囲' })
      .getByRole('button', { name: '夫婦' })
      .click();
    await signedIn.getByLabel('カテゴリ').selectOption({ label: '家賃' });
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
    await seedGroup(users);
    await seedCategory({ name: '家賃' });

    await signedIn.goto('/new');
    await signedIn.getByRole('group', { name: '共有範囲' })
      .getByRole('button', { name: '夫婦' })
      .click();
    await signedIn.getByLabel('カテゴリ').selectOption({ label: '家賃' });
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
    const category = await seedCategory({ name: '家賃' });
    const id = await seedTransaction({
      categoryId: category,
      shareGroupId: group,
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
    const category = await systemCategoryOf('expense');
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
    await confirmDialog(signedIn);

    await expect(signedIn.getByText('取引がありません')).toBeVisible();
    const splits = await splitsOf(id);
    expect(splits).toEqual([]);
  });

  test('列13 保存して続けて入力すると日付とカテゴリが残り金額が空になる', async ({
    signedIn,
  }) => {
    await seedCategory({ name: '食費' });

    await signedIn.goto('/new');
    await signedIn.getByLabel('カテゴリ').selectOption({ label: '食費' });
    await signedIn.getByLabel('金額').fill('780');
    await signedIn.getByLabel('備考').fill('昼食');
    await signedIn.getByRole('button', { name: '保存して続けて入力' }).click();

    await expect(signedIn.getByText('保存しました')).toBeVisible();
    await expect(signedIn.getByLabel('金額')).toHaveValue('');
    await expect(signedIn.getByLabel('備考')).toHaveValue('');
    await expect(signedIn.getByLabel('カテゴリ')).not.toHaveValue('');
    await expect(signedIn.getByLabel('金額')).toBeFocused();
  });

  test('列13 編集では続けて入力できない', async ({ signedIn, users }) => {
    const category = await systemCategoryOf('expense');
    const id = await seedTransaction({
      categoryId: category,
      payerId: users.taro,
      createdBy: users.taro,
      occurredOn: today(),
      amount: 500,
      memo: '直す取引',
      splits: [{ userId: users.taro, amount: 500 }],
    });

    await signedIn.goto(`/transactions/${id}/edit`);
    await expect(signedIn.getByLabel('備考')).toHaveValue('直す取引');

    // 押せると同じ取引を上書きし続けてしまうので出さない
    await expect(signedIn.getByRole('button', { name: '保存して続けて入力' })).toBeHidden();
    await expect(signedIn.getByRole('button', { name: '保存', exact: true })).toBeVisible();
  });

  test('列16 金額に式を入れると結果が欄の下に出て、その値で保存される', async ({
    signedIn,
  }) => {
    await seedCategory({ name: '外食' });

    await signedIn.goto('/new');
    await signedIn.getByLabel('カテゴリ').selectOption({ label: '外食' });
    await signedIn.getByLabel('金額').fill('1200+800');
    await expect(signedIn.getByText('= 2,000')).toBeVisible();

    await signedIn.getByRole('button', { name: '保存', exact: true }).click();
    await expect(signedIn.getByRole('heading', { name: '取引一覧' })).toBeVisible();
    expect((await latestTransaction()).amount).toBe(2000);
  });

  test('列16 演算子ボタンで式を組み立てられる', async ({ signedIn }) => {
    await seedCategory({ name: '交通費' });

    await signedIn.goto('/new');
    await signedIn.getByLabel('カテゴリ').selectOption({ label: '交通費' });
    await signedIn.getByLabel('金額').fill('420');
    await signedIn.getByRole('button', { name: '×' }).click();
    await signedIn.getByLabel('金額').pressSequentially('3');
    await expect(signedIn.getByLabel('金額')).toHaveValue('420*3');
    await expect(signedIn.getByText('= 1,260')).toBeVisible();
  });

  test('列17 計算できない式では保存できない', async ({ signedIn }) => {
    await seedCategory({ name: '雑貨' });

    await signedIn.goto('/new');
    await signedIn.getByLabel('カテゴリ').selectOption({ label: '雑貨' });
    await signedIn.getByLabel('金額').fill('1200+');
    // 入力の途中で責めない。計算できないと出すのは保存を押してから
    await expect(signedIn.getByText('計算できません', { exact: true })).toBeHidden();

    await signedIn.getByRole('button', { name: '保存', exact: true }).click();
    await expect(signedIn.getByRole('alert')).toBeVisible();
    await expect(signedIn.getByText('計算できません', { exact: true })).toBeVisible();
    await expect(signedIn.getByRole('heading', { name: '取引を入力' })).toBeVisible();

    // 直したらその場で消える
    await signedIn.getByLabel('金額').fill('1200+300');
    await expect(signedIn.getByText('計算できません', { exact: true })).toBeHidden();
    await expect(signedIn.getByText('= 1,500')).toBeVisible();
  });
  test('列18 小分類を持つ大分類はそのまま選んで保存できる', async ({ signedIn }) => {
    const parent = await seedCategory({ name: '食費' });
    await seedCategory({ name: '外食', parentId: parent });

    await signedIn.goto('/new');
    await signedIn.getByLabel('カテゴリ').selectOption({ label: '食費' });
    await signedIn.getByLabel('金額').fill('500');
    await signedIn.getByRole('button', { name: '保存', exact: true }).click();

    await expect(signedIn.getByRole('heading', { name: '取引一覧' })).toBeVisible();
    const { data } = await adminClient()
      .from('transactions')
      .select('category_id')
      .eq('amount', 500)
      .single();
    expect((data as { category_id: string }).category_id).toBe(parent);
  });

  test('列19 小分類を選んでも共有範囲は変わらない', async ({ signedIn, users }) => {
    await seedGroup(users);
    const parent = await seedCategory({ name: '食費' });
    const child = await seedCategory({ name: '外食', parentId: parent });

    await signedIn.goto('/new');
    await signedIn.getByRole('group', { name: '共有範囲' })
      .getByRole('button', { name: '夫婦' })
      .click();
    await signedIn.getByLabel('カテゴリ').selectOption({ label: '食費 / 外食' });
    await signedIn.getByLabel('金額').fill('1000');
    // 共有範囲は取引が持つ（§2.4）。小分類を選んでも「夫婦」のままで、
    // 負担は夫婦の既定割合で按分される
    await expect(signedIn.getByLabel('taroの負担')).toHaveValue('500');
    await expect(signedIn.getByLabel('hanaの負担')).toHaveValue('500');
    await signedIn.getByRole('button', { name: '保存', exact: true }).click();

    await expect(signedIn.getByRole('heading', { name: '取引一覧' })).toBeVisible();
    const { data } = await adminClient()
      .from('transactions')
      .select('category_id, transaction_splits(amount)')
      .eq('amount', 1000)
      .single();
    const saved = data as unknown as {
      category_id: string;
      transaction_splits: { amount: number }[];
    };
    expect(saved.category_id).toBe(child);
    expect(saved.transaction_splits.map((s) => s.amount).sort()).toEqual([500, 500]);
  });
});
