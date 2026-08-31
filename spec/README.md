# 決定表

機能の振る舞いは観点ごとの決定表として `tables/*.jsonl` に持つ。書式は
[docs/仕様書.md](../docs/仕様書.md) の §7 を参照。

```bash
npm run build      # tables/*.jsonl -> dist/index.html
npm run coverage   # 各列がテストで押さえられているかを数える
```

`dist/index.html` をブラウザで開くと全ての決定表が並ぶ。各表の上の数値入力欄に列番号を
入れると、その列に関係する行だけが残る。生成物はコミットしない。
