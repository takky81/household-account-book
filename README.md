# 家計簿

取引ごとに共有範囲を決める家計簿。決まった数人で使い、家賃や光熱費のように分担する支出は
「支払った人」と「負担する人」を分けて記録する。カテゴリは全員共通の名前で、同じ「食費」に
夫婦の支出と個人の支出が並ぶ。

- 仕様（システム構成・データモデル・データ形式・算出ルール）は [docs/仕様書.md](docs/仕様書.md)
- 機能の振る舞いは決定表 [spec/tables/\*.jsonl](spec/tables)（表示は `npm run spec`）
- 画面の見た目は [design/wireframes.html](design/wireframes.html)

## 進み具合

| 段階 | 状態 |
| --- | --- |
| 仕様書 | できている |
| DB（マイグレーション・RLS・RPC・pgTAP） | できている |
| 決定表 | 14表204列 |
| ワイヤーフレーム | できている |
| 画面の実装 | できている |
| テスト | ユニット 293 / pgTAP 107 / E2E 98 |

決定表のカバレッジ（`npm run spec:coverage`）は 142/142 列。押さえられていない列があると
CI が落ちる。

## 始め方

```bash
npm install
npm run db:start          # ローカル Supabase（Docker が要る）
cp .env.example .env.local
npm run db:status         # 出てきた anon key を .env.local に書き写す
npm run dev
```

ポートは blank-study と重ならないようにずらしてある（API 54421 / DB 54422 / Studio 54423）。

## よく使うコマンド

```bash
npm run dev            # 開発サーバー
npm test               # ユニットテスト
npm run typecheck      # 型検査
npm run build          # 型検査 + ビルド
npm run db:reset       # マイグレーションを流し直す
npm run db:test        # DB のテスト（supabase/tests/*.test.sql）
npm run test:e2e       # E2E（先に db:start が要る。dev サーバーは自動で立つ）
npm run spec           # 決定表を spec/dist/index.html に出す
npm run spec:coverage  # 決定表の列がテストで押さえられているかを数える
```

## 本番へ出す

配信は GitHub Pages、データは Supabase のホスト版。**アプリを配信する前に Supabase 側を
先に整える**（順番を逆にすると、開いた人がログインできないか、誰でもアカウントを作れる状態になる）。

### 1. Supabase プロジェクト

```bash
npx supabase link --project-ref <プロジェクトの ref>
npx supabase db push        # supabase/migrations/*.sql を本番へ適用する
```

`supabase/config.toml` は**ローカルの Docker にしか効かない**。本番の同じ設定は管理画面で行う。

| 管理画面の場所 | 値 | 理由 |
| --- | --- | --- |
| Authentication > Sign In / Providers | **Allow new users to sign up: オフ** | 閉じ忘れると誰でもアカウントを作れる。データは RLS が守るが、無関係な利用者が増える（§2.3） |
| Authentication > Sign In / Providers | Email: オン、Confirm email: オフ | メールは送らない。ログインIDとしてだけ使う |
| Authentication > URL Configuration | Site URL に Pages の URL | |
| Authentication > Users | 利用者を手で追加 | サインアップを閉じているため。表示名はメールのローカル部から自動で付く |

### 2. GitHub

- リポジトリの Settings > Secrets に `VITE_SUPABASE_URL` と
  `VITE_SUPABASE_ANON_KEY`（新しいプロジェクトなら `VITE_SUPABASE_PUBLISHABLE_KEY`）を登録する。
  未登録でもビルドは通るが、開いた人には「設定が足りません」の画面しか出ない
- Settings > Pages の Source を GitHub Actions にする
- `main` に入ると [deploy.yml](.github/workflows/deploy.yml) が配信する

anon key はブラウザに出る前提の公開値。実際の権限は RLS が決める（§2.3）。

### 3. 出したあとの確認

- ログインできる
- `https://<user>.github.io/household-account-book/budget` を直接開いても 404 にならない
  （`npm run build` が `dist/404.html` を作る）
- 別の利用者でログインし、他人の個人の取引が見えないこと（カテゴリは全員共通なので見える）

## 作りの要点

- **共有範囲は取引が持つ。** 取引・予算・定期登録ルールがそれぞれ `share_group_id` /
  `owner_id` を持つ。**カテゴリは全ユーザー共通のマスタ**で共有範囲を持たず、名前は
  収支区分ごとに全体で一意。誰でも作れて誰でも直せるが、削除だけは自分しか使っていない
  ときに限る（他人の取引が黙って未分類へ飛ぶため）
- **負担は別テーブル。** 合計が金額に一致することは行トリガでは検査できないため、取引と負担は
  `upsert_transaction()` でまとめて書き、関数の末尾で1回だけ検査する。取引の INSERT と
  金額・カテゴリ・共有範囲の UPDATE、負担の直接の書き込みは `authenticated` に与えていない
- **列の制限は GRANT で行う。** テーブルレベルの UPDATE は全列を含み、そこから
  `revoke update (col)` で差し引けない。許可列だけを列挙して grant する
- **テストは決定表の列に紐づける。** テスト名を「列N …」で始めると
  `npm run spec:coverage` が数える。画面から作れない状況（存在しない利用者、非メンバーの
  操作）は pgTAP に、画面の振る舞いは E2E に置く。pgTAP と E2E は同じ DB を使うので、
  pgTAP 側の利用者とグループ名は `pg-` で始めて衝突を避けている
- **REST にさらす関数を絞る。** PostgREST は公開スキーマの関数を
  `/rest/v1/rpc/<名前>` として全部さらす。ポリシーやトリガから呼ぶ判定関数は
  `authenticated` に EXECUTE を与えざるを得ないので `private` スキーマへ置く。
  さらしてよいのは画面が呼ぶ RPC 9本だけで、その範囲は
  `supabase/tests/05-exposure.test.sql` が固定している
- **RLS の穴は pgTAP で塞いだことを確かめる。** `supabase/tests/02-access.test.sql` は
  supabase-js から直接叩ける操作を SQL で再現し、通らないことを見ている
