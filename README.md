# 家計簿

カテゴリごとに共有範囲を決める家計簿。決まった数人で使い、家賃や光熱費のように分担する支出は
「支払った人」と「負担する人」を分けて記録する。

- 仕様（システム構成・データモデル・データ形式・算出ルール）は [docs/仕様書.md](docs/仕様書.md)
- 機能の振る舞いは決定表 [spec/tables/\*.jsonl](spec/tables)（表示は `npm run spec`）
- 画面の見た目は [design/wireframes.html](design/wireframes.html)

## 進み具合

| 段階 | 状態 |
| --- | --- |
| 仕様書 | できている |
| DB（マイグレーション・RLS・RPC・pgTAP） | できている |
| 決定表 | 12表140列 |
| ワイヤーフレーム | できている |
| 画面の実装 | できている |
| テスト | ユニット 196 / pgTAP 45 / E2E 59 |

決定表のカバレッジ（`npm run spec:coverage`）は 140/140 列。押さえられていない列があると
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

## 作りの要点

- **共有範囲はカテゴリが持つ。** 取引は共有範囲の列を持たず、カテゴリをたどって決まる。
  同じ「食費」でも共有用と個人用ならカテゴリを分ける
- **負担は別テーブル。** 合計が金額に一致することは行トリガでは検査できないため、取引と負担は
  `upsert_transaction()` でまとめて書き、関数の末尾で1回だけ検査する。取引の INSERT と
  金額・カテゴリの UPDATE、負担の直接の書き込みは `authenticated` に与えていない
- **列の制限は GRANT で行う。** テーブルレベルの UPDATE は全列を含み、そこから
  `revoke update (col)` で差し引けない。許可列だけを列挙して grant する
- **テストは決定表の列に紐づける。** テスト名を「列N …」で始めると
  `npm run spec:coverage` が数える。画面から作れない状況（存在しない利用者、非メンバーの
  操作）は pgTAP に、画面の振る舞いは E2E に置く。pgTAP と E2E は同じ DB を使うので、
  pgTAP 側の利用者とグループ名は `pg-` で始めて衝突を避けている
- **RLS の穴は pgTAP で塞いだことを確かめる。** `supabase/tests/02-access.test.sql` は
  supabase-js から直接叩ける操作を SQL で再現し、通らないことを見ている
