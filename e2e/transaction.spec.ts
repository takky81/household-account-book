import { test, expect, chooseCategory, confirmDialog } from './fixtures';
import { adminClient, seedCategory, seedGroup, seedTag, seedTransaction, systemCategoryOf } from './db';

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
  test('列21 取引に複数タグを付けて保存できる', async ({ signedIn, users }) => {
    void users;
    await seedCategory({ name: '交通費' });
    await seedTag('旅行');
    await seedTag('家族', '#f97316');

    await signedIn.goto('/new');
    await chooseCategory(signedIn, '交通費');
    await signedIn.getByLabel('金額').fill('1200');
    await signedIn.getByRole('checkbox', { name: '旅行', exact: true }).check();
    await signedIn.getByRole('checkbox', { name: '家族', exact: true }).check();
    await signedIn.getByRole('button', { name: '保存', exact: true }).click();

    await expect(signedIn.getByRole('heading', { name: '取引一覧' })).toBeVisible();
    const tx = await latestTransaction();
    const { data, error } = await adminClient()
      .from('transaction_tags')
      .select('tags(name)')
      .eq('transaction_id', tx.id);
    if (error !== null) throw error;
    expect(data.map((row) => (row.tags as unknown as { name: string }).name).sort()).toEqual(['家族', '旅行']);
    await expect(signedIn.getByText('旅行')).toBeVisible();
    await expect(signedIn.getByText('家族')).toBeVisible();
  });

  test('列22 編集でタグを置き換え、すべて外せる', async ({ signedIn, users }) => {
    const category = await seedCategory({ name: '交通費' });
    const travel = await seedTag('旅行');
    const work = await seedTag('出張');
    const tx = await seedTransaction({
      categoryId: category,
      ownerId: users.taro,
      payerId: users.taro,
      createdBy: users.taro,
      occurredOn: today(),
      amount: 1200,
      splits: [{ userId: users.taro, amount: 1200 }],
      tagIds: [travel],
    });

    await signedIn.goto(`/transactions/${tx}/edit`);
    await expect(signedIn.getByRole('checkbox', { name: '旅行', exact: true })).toBeChecked();
    await signedIn.getByRole('checkbox', { name: '旅行', exact: true }).uncheck();
    await signedIn.getByRole('checkbox', { name: '出張', exact: true }).check();
    await signedIn.getByRole('button', { name: '保存', exact: true }).click();
    await expect(signedIn.getByRole('heading', { name: '取引一覧' })).toBeVisible();

    let tags = await adminClient().from('transaction_tags').select('tag_id').eq('transaction_id', tx);
    if (tags.error !== null) throw tags.error;
    expect(tags.data.map((row) => row.tag_id)).toEqual([work]);

    await signedIn.goto(`/transactions/${tx}/edit`);
    await expect(signedIn.getByRole('checkbox', { name: '出張', exact: true })).toBeChecked();
    await signedIn.getByRole('checkbox', { name: '出張', exact: true }).uncheck();
    await signedIn.getByRole('button', { name: '保存', exact: true }).click();
    await expect(signedIn.getByRole('heading', { name: '取引一覧' })).toBeVisible();

    tags = await adminClient().from('transaction_tags').select('tag_id').eq('transaction_id', tx);
    if (tags.error !== null) throw tags.error;
    expect(tags.data).toEqual([]);
  });

  test('列1 共有カテゴリの取引を入力すると既定割合で按分される', async ({ signedIn, users }) => {
    await seedGroup(users);
    await seedCategory({ name: '家賃' });

    await signedIn.goto('/new');
    await signedIn.getByRole('group', { name: '共有範囲' })
      .getByRole('button', { name: '夫婦' })
      .click();
    await chooseCategory(signedIn, '家賃');
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
    await chooseCategory(signedIn, '食費');
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
    await chooseCategory(signedIn, '日用品');
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
    await chooseCategory(signedIn, '家賃');
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
    await chooseCategory(signedIn, '家賃');
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

  test('列13 続けて入力すると日付とカテゴリが残り金額が空になる', async ({
    signedIn,
  }) => {
    await seedCategory({ name: '食費' });

    await signedIn.goto('/new');
    await chooseCategory(signedIn, '食費');
    await signedIn.getByLabel('金額').fill('780');
    await signedIn.getByLabel('備考').fill('昼食');
    await signedIn.getByRole('button', { name: '続けて入力' }).click();

    await expect(signedIn.getByText('保存しました')).toBeVisible();
    await expect(signedIn.getByLabel('金額')).toHaveValue('');
    await expect(signedIn.getByLabel('備考')).toHaveValue('');
    await expect(signedIn.getByRole('button', { name: 'カテゴリ', exact: true })).toHaveText('食費');
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
    await expect(signedIn.getByRole('button', { name: '続けて入力' })).toBeHidden();
    await expect(signedIn.getByRole('button', { name: '保存', exact: true })).toBeVisible();
  });

  test('列16 金額に式を入れると結果が欄の下に出て、その値で保存される', async ({
    signedIn,
  }) => {
    await seedCategory({ name: '外食' });

    await signedIn.goto('/new');
    await chooseCategory(signedIn, '外食');
    await signedIn.getByLabel('金額').fill('1200+800');
    await expect(signedIn.getByText('= 2,000')).toBeVisible();

    await signedIn.getByRole('button', { name: '保存', exact: true }).click();
    await expect(signedIn.getByRole('heading', { name: '取引一覧' })).toBeVisible();
    expect((await latestTransaction()).amount).toBe(2000);
  });

  test('列16 演算子ボタンで式を組み立てられる', async ({ signedIn }) => {
    await seedCategory({ name: '交通費' });

    await signedIn.goto('/new');
    await chooseCategory(signedIn, '交通費');
    await signedIn.getByLabel('金額').fill('420');
    await signedIn.getByRole('button', { name: '×' }).click();
    await signedIn.getByLabel('金額').pressSequentially('3');
    await expect(signedIn.getByLabel('金額')).toHaveValue('420*3');
    await expect(signedIn.getByText('= 1,260')).toBeVisible();
  });

  test('列16 スマホでは数字と演算子を電卓キーボードから入力できる', async ({ signedIn }) => {
    await signedIn.setViewportSize({ width: 390, height: 844 });
    await seedCategory({ name: 'スマホ入力' });

    await signedIn.goto('/new');
    await chooseCategory(signedIn, 'スマホ入力');
    const amount = signedIn.getByRole('textbox', { name: '金額', exact: true });
    await amount.click();

    const keypad = signedIn.getByRole('region', { name: '金額の電卓キーボード' });
    await expect(keypad).toBeVisible();
    await expect(amount).toHaveAttribute('readonly', '');
    await expect(amount).toHaveAttribute('inputmode', 'none');

    for (const key of ['1', '2', '0', '0', '＋', '8', '0', '0']) {
      await keypad.getByRole('button', { name: key, exact: true }).click();
    }
    await expect(amount).toHaveValue('1200+800');
    await expect(signedIn.getByText('= 2,000')).toBeVisible();

    await keypad.getByRole('button', { name: '1文字削除' }).click();
    await expect(amount).toHaveValue('1200+80');
    await keypad.getByRole('button', { name: 'クリア' }).click();
    await expect(amount).toHaveValue('');

    await keypad.getByRole('button', { name: '完了' }).click();
    await expect(keypad).toBeHidden();
  });

  test('列16 小数をそのまま打つと四捨五入して保存される', async ({ signedIn }) => {
    await seedCategory({ name: '日用品' });

    await signedIn.goto('/new');
    await chooseCategory(signedIn, '日用品');
    // 広い画面では物理キーボードから小数点を入力できる
    await signedIn.getByLabel('金額').fill('1980.5');
    await expect(signedIn.getByText('= 1,981（四捨五入）')).toBeVisible();

    await signedIn.getByRole('button', { name: '保存', exact: true }).click();
    await expect(signedIn.getByRole('heading', { name: '取引一覧' })).toBeVisible();
    expect((await latestTransaction()).amount).toBe(1981);
  });

  test('列17 計算できない式では保存できない', async ({ signedIn }) => {
    await seedCategory({ name: '雑貨' });

    await signedIn.goto('/new');
    await chooseCategory(signedIn, '雑貨');
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
    await chooseCategory(signedIn, '食費');
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
    await chooseCategory(signedIn, '食費', '外食');
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

  test('列23 1つのメニューで大カテゴリから小カテゴリへ進んで選べる', async ({ signedIn }) => {
    const food = await seedCategory({ name: '食費' });
    const transport = await seedCategory({ name: '交通費' });
    await seedCategory({ name: '外食', parentId: food });
    await seedCategory({ name: '電車', parentId: transport });

    await signedIn.goto('/new');
    const trigger = signedIn.getByRole('button', { name: 'カテゴリ', exact: true });
    await trigger.click();
    const menu = signedIn.getByRole('menu', { name: 'カテゴリの選択肢' });

    // 最初は大カテゴリだけを並べる。
    await expect(menu.getByRole('menuitem', { name: '食費', exact: true })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: '交通費', exact: true })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: '外食', exact: true })).toHaveCount(0);
    await expect(menu.getByRole('menuitem', { name: '電車', exact: true })).toHaveCount(0);

    // 大カテゴリを押すと、その大カテゴリ自体と配下の小カテゴリへ自動で切り替わる。
    await menu.getByRole('menuitem', { name: '食費', exact: true }).click();
    await expect(trigger).toHaveText('食費');
    await expect(menu.getByRole('menuitem', { name: '食費（大カテゴリ）' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: '外食', exact: true })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: '電車', exact: true })).toHaveCount(0);
    await menu.getByRole('menuitem', { name: '外食', exact: true }).click();
    await expect(trigger).toHaveText('食費 / 外食');

    // 配下がある場合も「大カテゴリのまま」を明示的に選べる。
    await trigger.click();
    await menu.getByRole('menuitem', { name: '交通費', exact: true }).click();
    await menu.getByRole('menuitem', { name: '交通費（大カテゴリ）' }).click();
    await expect(trigger).toHaveText('交通費');

    await signedIn.getByLabel('金額').fill('420');
    await signedIn.getByRole('button', { name: '保存', exact: true }).click();
    await expect(signedIn.getByRole('heading', { name: '取引一覧' })).toBeVisible();
    const { data, error } = await adminClient()
      .from('transactions')
      .select('category_id')
      .eq('amount', 420)
      .single();
    if (error !== null) throw error;
    expect((data as { category_id: string }).category_id).toBe(transport);
  });

  test('列24 共有範囲は保存操作と同じ見た目と大きさにする', async ({ signedIn, users }) => {
    await seedGroup(users);
    await signedIn.setViewportSize({ width: 375, height: 800 });
    await signedIn.goto('/new');

    const chooser = signedIn.getByRole('group', { name: '共有範囲' });
    const save = signedIn.getByRole('button', { name: '保存', exact: true });
    const continueButton = signedIn.getByRole('button', { name: '続けて入力' });
    const own = chooser.getByRole('button', { name: '個人' });
    const shared = chooser.getByRole('button', { name: '夫婦' });

    await expect(own).toHaveCSS(
      'background-color',
      await save.evaluate((el) => getComputedStyle(el).backgroundColor),
    );
    await expect(shared).toHaveCSS(
      'border-color',
      await continueButton.evaluate((el) => getComputedStyle(el).borderColor),
    );
    expect((await own.boundingBox())!.height).toBe((await save.boundingBox())!.height);
    expect((await shared.boundingBox())!.height).toBe((await continueButton.boundingBox())!.height);
  });

  test('列25 必須項目のラベルを任意項目より目立たせる', async ({ signedIn }) => {
    await signedIn.goto('/new');

    const labels = ['日付', '共有範囲', 'カテゴリ', '金額'];
    for (const name of labels) {
      const label = signedIn.getByText(name, { exact: true }).first();
      await expect(label).toHaveCSS('font-weight', '700');
      await expect(label).toHaveCSS('font-size', '14px');
    }

    const optional = signedIn.getByText('備考', { exact: true });
    await expect(optional).toHaveCSS('font-weight', '400');
    await expect(optional).toHaveCSS('font-size', '12px');
  });
});
