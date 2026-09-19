import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SupplyBanner } from './SupplyBanner';

describe('不足物資の帯', () => {
  it('列1 不足があれば件数を出して光る帯にする', () => {
    render(<SupplyBanner count={2} />, { wrapper: MemoryRouter });
    const link = screen.getByRole('link', { name: '不足物資が2件あります。編集する' });
    expect(link).toHaveClass('supply-alert-active');
    expect(link).toHaveAttribute('href', '/supplies');
  });

  it('列2 不足がなくても目立たない帯を残す', () => {
    render(<SupplyBanner count={0} />, { wrapper: MemoryRouter });
    const link = screen.getByRole('link', { name: '不足物資はありません。編集する' });
    expect(link).not.toHaveClass('supply-alert-active');
    expect(link).toHaveTextContent('ありません');
  });
});
