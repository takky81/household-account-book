import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TargetMonthProvider, useTargetMonth } from './targetMonth';

function MonthPage({ name }: { name: string }) {
  const { monthKey, setMonthKey } = useTargetMonth();
  return (
    <>
      <span>{`${name}:${monthKey}`}</span>
      <button type="button" onClick={() => setMonthKey('2026-08')}>
        2026年8月を選ぶ
      </button>
    </>
  );
}

function ScreenSwitch() {
  const [page, setPage] = useState<'home' | 'transactions'>('home');
  return (
    <TargetMonthProvider>
      {page === 'home' ? <MonthPage name="ホーム" /> : <MonthPage name="一覧" />}
      <button type="button" onClick={() => setPage('transactions')}>
        一覧へ移動
      </button>
    </TargetMonthProvider>
  );
}

describe('targetMonth', () => {
  it('列14 画面が切り替わっても選んだ月を保つ', () => {
    render(<ScreenSwitch />);

    fireEvent.click(screen.getByRole('button', { name: '2026年8月を選ぶ' }));
    expect(screen.getByText('ホーム:2026-08')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '一覧へ移動' }));
    expect(screen.getByText('一覧:2026-08')).toBeInTheDocument();
  });
});
