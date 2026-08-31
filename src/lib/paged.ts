/**
 * 1回の取得件数の上限を超えて全件を取る（仕様書 §5.2 の定数）。
 *
 * PostgREST は 1リクエストで返す行数に上限があり、超えてもエラーにならず
 * 黙って打ち切られる。件数を数えるだけならサーバ側で数え、
 * 中身が要るところはここで範囲を分けて取り切る。
 */

/** 1回に頼む件数。Supabase の max_rows（supabase/config.toml）と揃える。 */
export const PAGE_SIZE = 1000;

/** 1回ぶんの取得結果。total は絞り込んだ全体の件数（Content-Range の値）。 */
export type Page<T> = { rows: T[]; total: number | null };

/**
 * 範囲をずらしながら全件を取る。
 *
 * 進める幅は「頼んだ件数」ではなく「実際に返ってきた件数」にして、
 * 全体の件数に届くまで続ける。サーバ側の上限がこちらの想定より小さくても、
 * 短い応答を終わりと取り違えない。
 */
export async function fetchAll<T>(
  fetchPage: (from: number, to: number) => Promise<Page<T>>,
  pageSize: number = PAGE_SIZE,
): Promise<T[]> {
  const all: T[] = [];
  let total: number | null = null;

  for (;;) {
    const page = await fetchPage(all.length, all.length + pageSize - 1);
    all.push(...page.rows);
    if (page.total !== null) total = page.total;

    // これ以上返らない
    if (page.rows.length === 0) return all;
    // 全体の件数に届いた
    if (total !== null && all.length >= total) return all;
    // 件数が分からないときは、頼んだぶんに満たなければ終わりとみなす
    if (total === null && page.rows.length < pageSize) return all;
  }
}
