import { test, expect, confirmDialog } from './fixtures';
import { adminClient, seedCategory, seedGroup, seedTransaction } from './db';

async function groupNames(): Promise<string[]> {
  const { data, error } = await adminClient().from('share_groups').select('name').order('name');
  if (error !== null) throw error;
  return (data as { name: string }[]).map((g) => g.name);
}

async function memberIds(groupId: string): Promise<string[]> {
  const { data, error } = await adminClient()
    .from('share_group_members')
    .select('user_id')
    .eq('share_group_id', groupId);
  if (error !== null) throw error;
  return (data as { user_id: string }[]).map((m) => m.user_id);
}

async function splitCount(transactionId: string): Promise<number> {
  const { count, error } = await adminClient()
    .from('transaction_splits')
    .select('user_id', { count: 'exact', head: true })
    .eq('transaction_id', transactionId);
  if (error !== null) throw error;
  return count ?? 0;
}

test.describe('共有グループの管理', () => {
  test('列1 自分を含むグループを作るとメンバーが登録される', async ({ signedIn, users }) => {
    await signedIn.goto('/groups');
    await signedIn.getByLabel('グループ名').fill('夫婦');
    await signedIn.getByRole('checkbox', { name: 'hana' }).check();
    await signedIn.getByRole('button', { name: '作る' }).click();

    await expect(signedIn.getByLabel('夫婦の名前')).toHaveValue('夫婦');
    const { data } = await adminClient()
      .from('share_groups')
      .select('id')
      .eq('name', '夫婦')
      .single();
    const id = (data as { id: string }).id;
    expect((await memberIds(id)).sort()).toEqual([users.taro, users.hana].sort());

    // 未分類は全ユーザー共通で収支区分ごとに1件。グループを作っても増えない（§3.4）
    const { count } = await adminClient()
      .from('categories')
      .select('id', { count: 'exact', head: true })
      .eq('is_system', true);
    expect(count).toBe(2);
  });

  test('列2 自分を含まないグループは作れない', async ({ signedIn, users }) => {
    void users;
    await signedIn.goto('/groups');
    await signedIn.getByLabel('グループ名').fill('他人だけ');
    await signedIn.getByRole('checkbox', { name: 'taro', exact: true }).uncheck();
    await signedIn.getByRole('checkbox', { name: 'hana' }).check();
    await signedIn.getByRole('button', { name: '作る' }).click();

    await expect(signedIn.getByRole('alert')).toContainText('自分');
    expect(await groupNames()).toEqual([]);
  });

  test('列4 同じ名前のグループは作れない', async ({ signedIn, users }) => {
    await seedGroup(users);
    await signedIn.goto('/groups');
    await signedIn.getByLabel('グループ名').fill('夫婦');
    await signedIn.getByRole('button', { name: '作る' }).click();

    await expect(signedIn.getByRole('alert')).toContainText('同じ名前');
    expect(await groupNames()).toEqual(['夫婦']);
  });

  test('列5 個人という名前のグループは作れない', async ({ signedIn, users }) => {
    void users;
    await signedIn.goto('/groups');
    await signedIn.getByLabel('グループ名').fill('個人');
    await signedIn.getByRole('button', { name: '作る' }).click();

    await expect(signedIn.getByRole('alert')).toContainText('個人');
    expect(await groupNames()).toEqual([]);
  });

  test('列6 メンバーを後から追加しても既存の取引の負担は変わらない', async ({
    signedIn,
    users,
  }) => {
    const group = await seedGroup(users);
    const category = await seedCategory({ name: '家賃' });
    const tx = await seedTransaction({
      categoryId: category,
      shareGroupId: group,
      payerId: users.taro,
      createdBy: users.taro,
      occurredOn: '2026-09-01',
      amount: 1000,
      splits: [
        { userId: users.taro, amount: 500 },
        { userId: users.hana, amount: 500 },
      ],
    });

    await signedIn.goto('/groups');
    await signedIn.getByLabel('夫婦にメンバーを追加').selectOption({ label: 'other' });

    await expect(signedIn.getByLabel('otherの負担割合')).toBeVisible();
    expect((await memberIds(group)).sort()).toEqual([users.taro, users.hana, users.other].sort());
    expect(await splitCount(tx)).toBe(2);
  });

  test('列7 同じ人は二重に追加できない', async ({ signedIn, users }) => {
    const group = await seedGroup(users);

    await signedIn.goto('/groups');
    // すでにメンバーの人は選択肢に出ない
    await expect(signedIn.getByLabel('夫婦にメンバーを追加').getByRole('option')).toHaveText([
      '＋ メンバーを追加',
      'other',
    ]);
    expect((await memberIds(group)).length).toBe(2);
  });

  test('列9 メンバーを外しても過去の取引は残る', async ({ signedIn, users }) => {
    const group = await seedGroup(users);
    const category = await seedCategory({ name: '家賃' });
    const tx = await seedTransaction({
      categoryId: category,
      shareGroupId: group,
      payerId: users.hana,
      createdBy: users.taro,
      occurredOn: '2026-09-01',
      amount: 1000,
      splits: [
        { userId: users.taro, amount: 500 },
        { userId: users.hana, amount: 500 },
      ],
    });

    await signedIn.goto('/groups');
    await signedIn.getByLabel('hanaをグループから外す').click();
    await confirmDialog(signedIn, '外す');

    await expect(signedIn.getByLabel('hanaの負担割合')).toHaveCount(0);
    expect(await memberIds(group)).toEqual([users.taro]);
    expect(await splitCount(tx)).toBe(2);
  });

  test('列10 最後のメンバーは外せない', async ({ signedIn, users }) => {
    const group = await seedGroup(users);
    const { error } = await adminClient()
      .from('share_group_members')
      .delete()
      .eq('share_group_id', group)
      .eq('user_id', users.hana);
    if (error !== null) throw error;

    await signedIn.goto('/groups');
    await signedIn.getByLabel('taroをグループから外す').click();

    // 外せないものは確認を出すまでもなく止める
    await expect(signedIn.getByRole('dialog')).toHaveCount(0);
    await expect(signedIn.getByRole('alert')).toContainText('最後');
    expect(await memberIds(group)).toEqual([users.taro]);
  });

  test('列11 負担割合を変えても過去の取引は変わらない', async ({ signedIn, users }) => {
    const group = await seedGroup(users);
    const category = await seedCategory({ name: '家賃' });
    const tx = await seedTransaction({
      categoryId: category,
      shareGroupId: group,
      payerId: users.taro,
      createdBy: users.taro,
      occurredOn: '2026-09-01',
      amount: 1000,
      splits: [
        { userId: users.taro, amount: 500 },
        { userId: users.hana, amount: 500 },
      ],
    });

    await signedIn.goto('/groups');
    await signedIn.getByLabel('taroの負担割合').fill('3');
    await signedIn.getByLabel('taroの負担割合').blur();

    await expect
      .poll(async () => {
        const { data } = await adminClient()
          .from('share_group_members')
          .select('default_weight')
          .eq('share_group_id', group)
          .eq('user_id', users.taro)
          .single();
        return (data as { default_weight: number }).default_weight;
      })
      .toBe(3);

    const { data } = await adminClient()
      .from('transaction_splits')
      .select('amount')
      .eq('transaction_id', tx)
      .eq('user_id', users.taro)
      .single();
    expect((data as { amount: number }).amount).toBe(500);

    // 以後の入力には効く（3:1 で 750 / 250）
    await signedIn.goto('/new');
    await signedIn.getByRole('group', { name: '共有範囲' })
      .getByRole('button', { name: '夫婦' })
      .click();
    await signedIn.getByLabel('カテゴリ').selectOption({ label: '家賃' });
    await signedIn.getByLabel('金額').fill('1000');
    await expect(signedIn.getByLabel('taroの負担')).toHaveValue('750');
  });

  test('列12 空のグループを削除できる', async ({ signedIn, users }) => {
    const group = await seedGroup(users);

    await signedIn.goto('/groups');
    await signedIn.getByRole('button', { name: 'グループを削除' }).click();
    await confirmDialog(signedIn);

    await expect(signedIn.getByLabel('夫婦の名前')).toHaveCount(0);
    expect(await groupNames()).toEqual([]);
    expect(await memberIds(group)).toEqual([]);
  });

  test('列13 カテゴリが残っていてもグループは削除できる', async ({ signedIn, users }) => {
    // カテゴリは全ユーザー共通でグループに属さないので、削除の妨げにならない（§2.7）
    await seedGroup(users);
    await seedCategory({ name: '家賃' });

    await signedIn.goto('/groups');
    await signedIn.getByRole('button', { name: 'グループを削除' }).click();
    await confirmDialog(signedIn);

    await expect(signedIn.getByLabel('夫婦の名前')).toHaveCount(0);
    expect(await groupNames()).toEqual([]);
  });

  test('列14 取引が残るグループは削除できない', async ({ signedIn, users }) => {
    const group = await seedGroup(users);
    const category = await seedCategory({ name: '家賃' });
    await seedTransaction({
      categoryId: category,
      shareGroupId: group,
      payerId: users.taro,
      createdBy: users.taro,
      occurredOn: '2026-09-01',
      amount: 1000,
      splits: [
        { userId: users.taro, amount: 500 },
        { userId: users.hana, amount: 500 },
      ],
    });

    await signedIn.goto('/groups');
    await signedIn.getByRole('button', { name: 'グループを削除' }).click();
    await confirmDialog(signedIn);

    await expect(signedIn.getByRole('alert')).toContainText('取引が残っている');
    expect(await groupNames()).toEqual(['夫婦']);
  });
});
