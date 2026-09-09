import { test, expect } from './fixtures';
import { adminClient, seedCategory, seedTransaction } from './db';

test.describe('表示設定と共通の振る舞い', () => {
  test('列1 ダークモードに切り替えると次に開いても続く', async ({ signedIn }) => {
    await signedIn.goto('/settings');
    await signedIn.getByRole('button', { name: 'ダーク' }).click();

    await expect(signedIn.locator('html')).toHaveClass(/dark/);
    await signedIn.goto('/');
    await expect(signedIn.locator('html')).toHaveClass(/dark/);
  });

  test('列3 狭い画面では下のナビ、広い画面では上のナビになる', async ({ signedIn }) => {
    await signedIn.setViewportSize({ width: 375, height: 800 });
    await signedIn.goto('/');
    await expect(signedIn.getByTestId('nav-bottom')).toBeVisible();
    await expect(signedIn.getByTestId('nav-top')).toHaveCount(0);

    await signedIn.setViewportSize({ width: 1280, height: 900 });
    await expect(signedIn.getByTestId('nav-top')).toBeVisible();
    await expect(signedIn.getByTestId('nav-bottom')).toHaveCount(0);
  });

  test('列4 保存を続けて押しても取引は1件しかできない', async ({ signedIn }) => {
    await seedCategory({ name: '食費' });

    await signedIn.goto('/new');
    await signedIn.getByLabel('カテゴリ').selectOption({ label: '食費' });
    await signedIn.getByLabel('金額').fill('780');

    const save = signedIn.getByRole('button', { name: '保存', exact: true });
    await save.click({ clickCount: 3, delay: 0 });

    await expect(signedIn.getByRole('heading', { name: '取引一覧' })).toBeVisible();
    const { count } = await adminClient()
      .from('transactions')
      .select('id', { count: 'exact', head: true });
    expect(count).toBe(1);
  });

  test('列5 直リンクで画面を開ける', async ({ signedIn }) => {
    await signedIn.goto('/budget');
    await expect(signedIn.getByRole('heading', { name: '予算' })).toBeVisible();
    await signedIn.goto('/transactions/');
    await expect(signedIn.getByRole('heading', { name: '取引一覧' })).toBeVisible();

    // GitHub Pages のサブパスでは 404.html が同じ役目をする。
    // 中身が index.html と一致することは CI のビルド後に確かめている（.github/workflows/ci.yml）
  });

  test('列6 通信に失敗しても入力は消えない', async ({ signedIn }) => {
    await seedCategory({ name: '食費' });

    await signedIn.goto('/new');
    await signedIn.getByLabel('カテゴリ').selectOption({ label: '食費' });
    await signedIn.getByLabel('金額').fill('780');
    await signedIn.getByLabel('備考').fill('昼食');

    await signedIn.route('**/rest/v1/rpc/upsert_transaction', (route) => route.abort());
    await signedIn.getByRole('button', { name: '保存', exact: true }).click();

    await expect(signedIn.getByRole('alert')).toBeVisible();
    await expect(signedIn.getByLabel('金額')).toHaveValue('780');
    await expect(signedIn.getByLabel('備考')).toHaveValue('昼食');
    const { count } = await adminClient()
      .from('transactions')
      .select('id', { count: 'exact', head: true });
    expect(count).toBe(0);

    // 通信が戻れば、そのまま保存できる
    await signedIn.unroute('**/rest/v1/rpc/upsert_transaction');
    await signedIn.getByRole('button', { name: '保存', exact: true }).click();
    await expect(signedIn.getByRole('heading', { name: '取引一覧' })).toBeVisible();
  });

  test('列8 狭い画面の取引一覧はカードで並ぶ', async ({ signedIn, users }) => {
    const category = await seedCategory({ name: '食費' });
    const occurredOn = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
    await seedTransaction({
      categoryId: category,
      ownerId: users.taro,
      payerId: users.taro,
      createdBy: users.taro,
      occurredOn,
      amount: 1280,
      memo: '近所のスーパーでまとめ買い',
      splits: [{ userId: users.taro, amount: 1280 }],
    });

    await signedIn.setViewportSize({ width: 375, height: 800 });
    await signedIn.goto('/transactions');
    await expect(signedIn.getByTestId('tx-cards')).toBeVisible();
    await expect(signedIn.getByTestId('tx-table')).toHaveCount(0);

    // 備考が1文字ずつ縦に折り返されないこと。折り返されると幅より高さが勝つ。
    const memo = signedIn.getByText('近所のスーパーでまとめ買い');
    const box = (await memo.boundingBox())!;
    expect(box.width).toBeGreaterThan(box.height);

    await signedIn.setViewportSize({ width: 1280, height: 900 });
    await expect(signedIn.getByTestId('tx-table')).toBeVisible();
    await expect(signedIn.getByTestId('tx-cards')).toHaveCount(0);
  });
});
