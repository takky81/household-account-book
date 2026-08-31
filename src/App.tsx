/**
 * 画面はこれから作る。いまは足場だけを置いて、型検査とビルドが通る状態を保つ。
 * 画面の一覧は docs/仕様書.md §6、見た目は design/wireframes.html を正とする。
 */
export function App() {
  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-xl font-bold">家計簿</h1>
      <p className="mt-2 text-sm text-slate-600">
        仕様は docs/仕様書.md と spec/tables/*.jsonl を正とする。画面はこれから作る。
      </p>
    </main>
  );
}
