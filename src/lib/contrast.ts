/**
 * 色のコントラスト比。WCAG 2.1 の定義に合わせる。
 * 配色を変えたときに読めない組み合わせが混ざらないよう、テストから使う。
 */

/** #rgb / #rrggbb を 0-255 の3値にする。 */
export function toRgb(hex: string): [number, number, number] {
  const body = hex.trim().replace('#', '');
  const full =
    body.length === 3
      ? body
          .split('')
          .map((c) => c + c)
          .join('')
      : body;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`色として読めません: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

/** 相対輝度。0 が黒、1 が白。 */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((value) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** コントラスト比。1（同じ色）から 21（黒と白）までの値。 */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (light + 0.05) / (dark + 0.05);
}

/**
 * CSS から色の変数を読み出す。`:root` と `.dark` のように、
 * セレクタごとに `--c-*: #xxxxxx;` を集める。
 */
export function readTokens(css: string, selector: string): Record<string, string> {
  // 行頭のセレクタだけを見る。@custom-variant などの記述に引っかからないため
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const head = new RegExp(String.raw`^${escaped}\s*\{`, 'm').exec(css);
  if (head === null) throw new Error(`${selector} が見つかりません`);
  const open = css.indexOf('{', head.index);
  const close = css.indexOf('}', open);
  const block = css.slice(open + 1, close);

  const tokens: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const found = /^\s*--c-([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/.exec(line);
    if (found) tokens[found[1] as string] = found[2] as string;
  }
  return tokens;
}
