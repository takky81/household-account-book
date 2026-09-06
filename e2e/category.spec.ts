import { test, expect } from './fixtures';
import {
  adminClient,
  countBudgets,
  seedCategory,
  seedGroup,
  seedTransaction,
  systemCategoryOf,
} from './db';

async function categoryOf(name: string): Promise<{
  id: string;
  share_group_id: string | null;
  owner_id: string | null;
  is_archived: boolean;
  sort_order: number;
}> {
  const { data, error } = await adminClient()
    .from('categories')
    .select('id, share_group_id, owner_id, is_archived, sort_order')
    .eq('name', name)
    .single();
  if (error !== null) throw error;
  return data as {
    id: string;
    share_group_id: string | null;
    owner_id: string | null;
    is_archived: boolean;
    sort_order: number;
  };
}

/** 一覧の初期表示は今月なので、今日の日付で入れる */
function today(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
}

test.describe('カテゴリの管理', () => {
  test('列1 共有カテゴリを作ると共有範囲つきで並ぶ', async ({ signedIn, users }) => {
    const group = await seedGroup(users);

    await signedIn.goto('/categories');
    await signedIn.getByLabel('共有範囲').selectOption({ label: '夫婦' });
    await signedIn.getByLabel('カテゴリ名').fill('家賃');
    await signedIn.getByRole('button', { name: '追加' }).click();

    await expect(signedIn.getByLabel('家賃の名前')).toBeVisible();
    const category = await categoryOf('家賃');
    expect(category.share_group_id).toBe(group);
    expect(category.owner_id).toBeNull();

    // 取引の入力では共有範囲つきの名前で選べる
    await signedIn.goto('/new');
    await expect(signedIn.getByLabel('カテゴリ')).toContainText('夫婦 / 家賃');
  });

  test('列2 個人カテゴリは本人だけが見られる', async ({ signedIn, users }) => {
    await signedIn.goto('/categories');
    await signedIn.getByLabel('共有範囲').selectOption({ label: '個人' });
    await signedIn.getByLabel('カテゴリ名').fill('趣味');
    await signedIn.getByRole('button', { name: '追加' }).click();

    await expect(signedIn.getByLabel('趣味の名前')).toBeVisible();
    const category = await categoryOf('趣味');
    expect(category.share_group_id).toBeNull();
    expect(category.owner_id).toBe(users.taro);
  });

  test('列7 収支区分は変えられない', async ({ signedIn, users }) => {
    const id = await seedCategory({ ownerId: users.taro, name: '趣味', kind: 'expense' });

    await signedIn.goto('/categories');
    await expect(signedIn.getByLabel('趣味の名前')).toBeVisible();

    // 画面に収支区分を変える手立てがない。DB も更新を許していない
    const { error } = await adminClient().from('categories').update({ kind: 'income' }).eq('id', id);
    void error;
    const { data } = await adminClient().from('categories').select('kind').eq('id', id).single();
    expect((data as { kind: string }).kind).toBe('expense');
  });

  test('列8 アーカイブすると候補から外れるが過去の取引は残る', async ({ signedIn, users }) => {
    const category = await seedCategory({ ownerId: users.taro, name: '趣味' });
    await seedTransaction({
      categoryId: category,
      payerId: users.taro,
      createdBy: users.taro,
      occurredOn: today(),
      amount: 500,
      memo: '古い取引',
      splits: [{ userId: users.taro, amount: 500 }],
    });

    await signedIn.goto('/categories');
    await signedIn.getByRole('button', { name: 'アーカイブ' }).click();

    await expect(signedIn.getByText('アーカイブ済み')).toBeVisible();
    expect((await categoryOf('趣味')).is_archived).toBe(true);

    // 新規入力の候補から外れる
    await signedIn.goto('/new');
    await expect(signedIn.getByLabel('カテゴリ')).not.toContainText('趣味');

    // 既存の取引は残り、集計にも出る
    await signedIn.goto('/transactions');
    await expect(signedIn.getByText('古い取引')).toBeVisible();
    await signedIn.goto('/aggregate');
    await expect(signedIn.getByText('趣味')).toBeVisible();
  });

  test('列9 削除すると取引が未分類へ移り予算は消える', async ({ signedIn, users }) => {
    const group = await seedGroup(users);
    const category = await seedCategory({ shareGroupId: group, name: '家賃' });
    const tx = await seedTransaction({
      categoryId: category,
      payerId: users.taro,
      createdBy: users.taro,
      occurredOn: today(),
      amount: 1000,
      splits: [
        { userId: users.taro, amount: 700 },
        { userId: users.hana, amount: 300 },
      ],
    });
    const { error } = await adminClient()
      .from('budgets')
      .insert({ category_id: category, month: `${today().slice(0, 7)}-01`, amount: 50000 });
    if (error !== null) throw error;

    await signedIn.goto('/categories');
    await signedIn.getByRole('button', { name: '削除' }).click();

    await expect(signedIn.getByLabel('家賃の名前')).toHaveCount(0);
    expect(await countBudgets(category)).toBe(0);

    const { data } = await adminClient()
      .from('transactions')
      .select('category_id, categories(name, share_group_id)')
      .eq('id', tx)
      .single();
    const moved = data as unknown as {
      categories: { name: string; share_group_id: string | null };
    };
    expect(moved.categories.name).toBe('未分類');
    expect(moved.categories.share_group_id).toBe(group);

    // 共有範囲が変わらないので負担はそのまま
    const splits = await adminClient()
      .from('transaction_splits')
      .select('user_id, amount')
      .eq('transaction_id', tx)
      .eq('user_id', users.taro)
      .single();
    expect((splits.data as { amount: number }).amount).toBe(700);
  });

  test('列10・列11・列12 未分類は消せず改名もアーカイブもできない', async ({
    signedIn,
    users,
  }) => {
    const id = await systemCategoryOf(users.taro, 'expense');
    await seedCategory({ ownerId: users.taro, name: '趣味' });

    await signedIn.goto('/categories');
    await expect(signedIn.getByText('（消せない）')).toBeVisible();
    // 未分類には削除・アーカイブ・改名の手立てがない（普通のカテゴリにはある）
    await expect(signedIn.getByRole('button', { name: '削除' })).toHaveCount(1);
    await expect(signedIn.getByRole('button', { name: 'アーカイブ' })).toHaveCount(1);
    await expect(signedIn.getByLabel('未分類の名前')).toHaveCount(0);
    await expect(signedIn.getByLabel('趣味の名前')).toHaveCount(1);

    // DB も改名・アーカイブを拒む
    for (const patch of [{ name: 'その他' }, { is_archived: true }]) {
      const { error } = await adminClient().from('categories').update(patch).eq('id', id);
      expect(error).not.toBeNull();
    }
    const { data } = await adminClient()
      .from('categories')
      .select('name, is_archived')
      .eq('id', id)
      .single();
    expect(data).toEqual({ name: '未分類', is_archived: false });
  });

  test('列13 複製先に同名があると実行前に知らせる', async ({ signedIn, users }) => {
    const group = await seedGroup(users);
    await seedCategory({ shareGroupId: group, name: '食費' });
    await seedCategory({ ownerId: users.taro, name: '食費' });

    await signedIn.goto('/categories');
    await signedIn.getByLabel('食費の移動先').first().selectOption({ label: '個人へ' });

    await expect(signedIn.getByRole('alert')).toContainText('統合しますか');
    // 知らせるだけで、まだ移していない
    const { count } = await adminClient()
      .from('categories')
      .select('id', { count: 'exact', head: true })
      .eq('name', '食費')
      .eq('share_group_id', group);
    expect(count).toBe(1);
  });

  test('カテゴリの名前を変えられる', async ({ signedIn, users }) => {
    await seedCategory({ ownerId: users.taro, name: '趣味' });

    await signedIn.goto('/categories');
    await signedIn.getByLabel('趣味の名前').fill('娯楽');
    await signedIn.getByLabel('趣味の名前').blur();

    await expect(signedIn.getByLabel('娯楽の名前')).toBeVisible();
    expect((await categoryOf('娯楽')).owner_id).toBe(users.taro);
  });

  test('列3 同じ共有範囲に同じ名前へは変えられない', async ({ signedIn, users }) => {
    await seedCategory({ ownerId: users.taro, name: '趣味' });
    await seedCategory({ ownerId: users.taro, name: '食費' });

    await signedIn.goto('/categories');
    await signedIn.getByLabel('趣味の名前').fill('食費');
    await signedIn.getByLabel('趣味の名前').blur();

    await expect(signedIn.getByRole('alert')).toContainText('同じ名前');
    expect((await categoryOf('趣味')).owner_id).toBe(users.taro);
  });

  test('列14 表示順を変えると入力の候補も並び替わる', async ({ signedIn }) => {
    await signedIn.goto('/categories');
    for (const name of ['趣味', '食費']) {
      await signedIn.getByLabel('カテゴリ名').fill(name);
      await signedIn.getByRole('button', { name: '追加' }).click();
      await expect(signedIn.getByLabel(`${name}の名前`)).toBeVisible();
    }

    await signedIn.getByRole('button', { name: '食費を上へ' }).click();
    await expect
      .poll(async () => {
        const [moved, other] = await Promise.all([categoryOf('食費'), categoryOf('趣味')]);
        return moved.sort_order < other.sort_order;
      })
      .toBe(true);

    // 未分類は末尾のまま（並べ替えの対象にしない）
    expect((await categoryOf('趣味')).sort_order).toBeLessThan(9999);

    // 入力の候補も同じ順で並ぶ
    await signedIn.goto('/new');
    const select = signedIn.getByLabel('カテゴリ');
    await expect(select).toContainText('食費');
    const options = await select.locator('option').allTextContents();
    const at = (name: string) => options.findIndex((text) => text.includes(name));
    expect(at('食費')).toBeLessThan(at('趣味'));
    expect(at('趣味')).toBeLessThan(at('未分類'));
  });
  test('列15 大分類の下に小分類を作れる', async ({ signedIn, users }) => {
    const parent = await seedCategory({ ownerId: users.taro, name: '食費' });

    await signedIn.goto('/categories');
    await signedIn.getByLabel('親カテゴリ').selectOption({ label: '食費' });
    await signedIn.getByLabel('カテゴリ名').fill('外食');
    await signedIn.getByRole('button', { name: '追加' }).click();

    await expect(signedIn.getByLabel('外食の名前')).toBeVisible();
    const { data } = await adminClient()
      .from('categories')
      .select('parent_id, share_group_id, owner_id, kind')
      .eq('name', '外食')
      .single();
    // 共有範囲と収支区分は親から引き継ぐ
    expect(data).toEqual({
      parent_id: parent,
      share_group_id: null,
      owner_id: users.taro,
      kind: 'expense',
    });

    // 取引の入力では『大分類 / 小分類』で選べる
    await signedIn.goto('/new');
    await expect(signedIn.getByLabel('カテゴリ')).toContainText('個人 / 食費 / 外食');
  });

  test('列20 小分類を削除すると取引が親へ移る', async ({ signedIn, users }) => {
    const parent = await seedCategory({ ownerId: users.taro, name: '食費' });
    const child = await seedCategory({ ownerId: users.taro, name: '外食', parentId: parent });
    const tx = await seedTransaction({
      categoryId: child,
      payerId: users.taro,
      createdBy: users.taro,
      occurredOn: today(),
      amount: 780,
      memo: '昼食',
      splits: [{ userId: users.taro, amount: 780 }],
    });

    await signedIn.goto('/categories');
    await signedIn.getByLabel('外食を削除').click();

    await expect(signedIn.getByLabel('外食の名前')).toHaveCount(0);
    const { data } = await adminClient()
      .from('transactions')
      .select('category_id')
      .eq('id', tx)
      .single();
    // 未分類ではなく親の食費へ移る
    expect((data as { category_id: string }).category_id).toBe(parent);
  });

  test('列21 小分類が残っている大分類は削除できない', async ({ signedIn, users }) => {
    const parent = await seedCategory({ ownerId: users.taro, name: '食費' });
    await seedCategory({ ownerId: users.taro, name: '外食', parentId: parent });

    await signedIn.goto('/categories');
    await signedIn.getByLabel('食費を削除').click();

    await expect(signedIn.getByRole('alert')).toContainText('小分類');
    await expect(signedIn.getByLabel('食費の名前')).toBeVisible();
    const { count } = await adminClient()
      .from('categories')
      .select('id', { count: 'exact', head: true })
      .eq('id', parent);
    expect(count).toBe(1);
  });

  test('列22 親をアーカイブすると小分類も候補から外れる', async ({ signedIn, users }) => {
    const parent = await seedCategory({ ownerId: users.taro, name: '食費' });
    const child = await seedCategory({ ownerId: users.taro, name: '外食', parentId: parent });

    await signedIn.goto('/categories');
    await signedIn.getByLabel('食費をアーカイブ').click();
    await expect(signedIn.getByText('アーカイブ済み')).toBeVisible();

    // 子の is_archived は書き換えない
    const { data } = await adminClient()
      .from('categories')
      .select('is_archived')
      .eq('id', child)
      .single();
    expect((data as { is_archived: boolean }).is_archived).toBe(false);

    // それでも新規入力の候補からは外れる
    await signedIn.goto('/new');
    await expect(signedIn.getByLabel('カテゴリ')).not.toContainText('外食');
    await expect(signedIn.getByLabel('カテゴリ')).not.toContainText('食費');
  });

  test('列23 小分類は同じ親の中で並べ替わる', async ({ signedIn, users }) => {
    const parent = await seedCategory({ ownerId: users.taro, name: '食費' });
    await seedCategory({ ownerId: users.taro, name: '自炊', parentId: parent, sortOrder: 10 });
    await seedCategory({ ownerId: users.taro, name: '外食', parentId: parent, sortOrder: 20 });

    await signedIn.goto('/categories');
    await signedIn.getByRole('button', { name: '外食を上へ' }).click();

    await expect
      .poll(async () => {
        const [外食, 自炊] = await Promise.all([categoryOf('外食'), categoryOf('自炊')]);
        return 外食.sort_order < 自炊.sort_order;
      })
      .toBe(true);
    // 親の表示順は動かない
    expect((await categoryOf('食費')).sort_order).toBe(10);

    await signedIn.goto('/new');
    const select = signedIn.getByLabel('カテゴリ');
    await expect(select).toContainText('外食');
    const options = await select.locator('option').allTextContents();
    const at = (name: string) => options.findIndex((text) => text.includes(name));
    expect(at('外食')).toBeLessThan(at('自炊'));
  });
});
