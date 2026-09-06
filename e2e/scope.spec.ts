import { test, expect } from './fixtures';
import { adminClient, seedCategory, seedGroup, seedTransaction } from './db';

async function splitsOf(transactionId: string): Promise<{ user_id: string; amount: number }[]> {
  const { data, error } = await adminClient()
    .from('transaction_splits')
    .select('user_id, amount')
    .eq('transaction_id', transactionId);
  if (error !== null) throw error;
  return data as { user_id: string; amount: number }[];
}

test.describe('共有範囲の変更', () => {
  test('列12 1件だけならその場で別の共有範囲へ付け替えられる', async ({ signedIn, users }) => {
    const group = await seedGroup(users);
    const own = await seedCategory({ ownerId: users.taro, name: '食費' });
    await seedCategory({ shareGroupId: group, name: '外食' });
    const id = await seedTransaction({
      categoryId: own,
      payerId: users.taro,
      createdBy: users.taro,
      occurredOn: '2026-09-01',
      amount: 1000,
      memo: '付け替える取引',
      splits: [{ userId: users.taro, amount: 1000 }],
    });

    await signedIn.goto(`/transactions/${id}/edit`);
    await expect(signedIn.getByLabel('備考')).toHaveValue('付け替える取引');
    await signedIn.getByLabel('カテゴリ').selectOption({ label: '夫婦 / 外食' });
    // 移動先の既定割合が先に画面へ出る
    await expect(signedIn.getByLabel('taroの負担')).toHaveValue('500');
    await signedIn.getByRole('button', { name: '保存', exact: true }).click();

    await expect(signedIn.getByRole('heading', { name: '取引一覧' })).toBeVisible();
    const { data } = await adminClient()
      .from('transactions')
      .select('category_id, categories(name, share_group_id)')
      .eq('id', id)
      .single();
    const moved = data as unknown as {
      categories: { name: string; share_group_id: string | null };
    };
    expect(moved.categories.name).toBe('外食');
    expect(moved.categories.share_group_id).toBe(group);

    // 負担は移動先の既定割合で作り直される
    const splits = await splitsOf(id);
    expect(splits.map((s) => s.amount).sort()).toEqual([500, 500]);
    expect(splits.map((s) => s.user_id).sort()).toEqual([users.taro, users.hana].sort());
  });

  test('列5 手で直した負担があると作り直す前に知らせる', async ({ signedIn, users }) => {
    const group = await seedGroup(users);
    const own = await seedCategory({ ownerId: users.taro, name: '食費' });
    const id = await seedTransaction({
      categoryId: own,
      payerId: users.taro,
      createdBy: users.taro,
      occurredOn: '2026-09-01',
      amount: 1000,
      splits: [{ userId: users.taro, amount: 1000 }],
    });
    const { error } = await adminClient()
      .from('transactions')
      .update({ splits_are_manual: true })
      .eq('id', id);
    if (error !== null) throw error;

    await signedIn.goto('/categories');
    await signedIn.getByLabel('食費の移動先').selectOption({ label: '夫婦へ' });

    await expect(signedIn.getByRole('alert')).toContainText('手で直した負担が 1 件');
    // 知らせるだけで、まだ移していない
    const { data } = await adminClient()
      .from('categories')
      .select('share_group_id')
      .eq('id', own)
      .single();
    expect((data as { share_group_id: string | null }).share_group_id).toBeNull();

    await signedIn.getByRole('button', { name: '移す' }).click();
    await expect
      .poll(async () => {
        const moved = await adminClient()
          .from('categories')
          .select('share_group_id')
          .eq('id', own)
          .single();
        return (moved.data as { share_group_id: string | null }).share_group_id;
      })
      .toBe(group);
    const splits = await splitsOf(id);
    expect(splits.map((s) => s.amount).sort()).toEqual([500, 500]);
  });
  test('列13 小分類だけでは共有範囲を変えられない', async ({ signedIn, users }) => {
    await seedGroup(users);
    const parent = await seedCategory({ ownerId: users.taro, name: '食費' });
    await seedCategory({ ownerId: users.taro, name: '外食', parentId: parent });

    await signedIn.goto('/categories');
    await expect(signedIn.getByLabel('外食の名前')).toBeVisible();
    // 小分類には移動先を選ぶ手立てがない（大分類ごと移す）
    await expect(signedIn.getByLabel('外食の移動先')).toHaveCount(0);
    await expect(signedIn.getByLabel('食費の移動先')).toHaveCount(1);
  });

  test('列14 大分類を移すと小分類とその取引も移る', async ({ signedIn, users }) => {
    const group = await seedGroup(users);
    const parent = await seedCategory({ ownerId: users.taro, name: '食費' });
    const child = await seedCategory({ ownerId: users.taro, name: '外食', parentId: parent });
    const tx = await seedTransaction({
      categoryId: child,
      payerId: users.taro,
      createdBy: users.taro,
      occurredOn: '2026-09-01',
      amount: 1000,
      splits: [{ userId: users.taro, amount: 1000 }],
    });

    await signedIn.goto('/categories');
    await signedIn.getByLabel('食費の移動先').selectOption({ label: '夫婦へ' });

    await expect
      .poll(async () => {
        const { data } = await adminClient()
          .from('categories')
          .select('share_group_id')
          .eq('id', child)
          .single();
        return (data as { share_group_id: string | null }).share_group_id;
      })
      .toBe(group);

    // 配下の取引は小分類に付いたまま、負担だけ移動先の既定割合で作り直される
    const { data } = await adminClient()
      .from('transactions')
      .select('category_id')
      .eq('id', tx)
      .single();
    expect((data as { category_id: string }).category_id).toBe(child);
    const splits = await splitsOf(tx);
    expect(splits.map((s) => s.amount).sort()).toEqual([500, 500]);
  });

  test('列15 統合すると移動元の小分類の取引が移動先の同名小分類へ移る', async ({
    signedIn,
    users,
  }) => {
    const group = await seedGroup(users);
    const own = await seedCategory({ ownerId: users.taro, name: '食費' });
    const ownChild = await seedCategory({ ownerId: users.taro, name: '外食', parentId: own });
    const groupParent = await seedCategory({ shareGroupId: group, name: '食費' });
    const groupChild = await seedCategory({
      shareGroupId: group,
      name: '外食',
      parentId: groupParent,
    });
    const tx = await seedTransaction({
      categoryId: ownChild,
      payerId: users.taro,
      createdBy: users.taro,
      occurredOn: '2026-09-01',
      amount: 1000,
      splits: [{ userId: users.taro, amount: 1000 }],
    });

    await signedIn.goto('/categories');
    await signedIn.getByLabel('食費の移動先').first().selectOption({ label: '夫婦へ' });
    await expect(signedIn.getByRole('alert')).toContainText('統合しますか');
    await signedIn.getByRole('button', { name: '統合して移す' }).click();

    await expect
      .poll(async () => {
        const { data } = await adminClient()
          .from('transactions')
          .select('category_id')
          .eq('id', tx)
          .single();
        return (data as { category_id: string }).category_id;
      })
      .toBe(groupChild);

    // 移動元のカテゴリは親子とも消える
    const { count } = await adminClient()
      .from('categories')
      .select('id', { count: 'exact', head: true })
      .in('id', [own, ownChild]);
    expect(count).toBe(0);
  });
});
