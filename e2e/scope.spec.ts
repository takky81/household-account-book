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
});
