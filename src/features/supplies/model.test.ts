import { missingCount } from './model';

describe('不足物資', () => {
  it('列1 不足中だけを件数に数える', () => {
    expect(missingCount([{ is_purchased: false }, { is_purchased: true }])).toBe(1);
  });

  it('列2 すべて購入済みなら0件になる', () => {
    expect(missingCount([{ is_purchased: true }, { is_purchased: true }])).toBe(0);
  });
});
