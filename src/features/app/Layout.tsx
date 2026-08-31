/** 画面の外枠。下部のナビと、対象月の前後移動を持つ。 */

import { NavLink, Outlet } from 'react-router-dom';
import { addMonths, formatMonth } from '../../lib/date';
import { cn } from '../../lib/utils';

const NAV = [
  { to: '/', label: 'ホーム', end: true },
  { to: '/new', label: '入力', end: false },
  { to: '/transactions', label: '一覧', end: false },
  { to: '/aggregate', label: '集計', end: false },
  { to: '/budget', label: '予算', end: false },
  { to: '/settings', label: '設定', end: false },
];

export function Layout() {
  return (
    <div className="min-h-screen pb-16">
      <Outlet />
      <nav className="fixed inset-x-0 bottom-0 flex justify-around border-t border-[var(--c-line)] bg-[var(--c-panel)] py-2 text-xs">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn('px-2', isActive ? 'font-bold text-[var(--c-ink)]' : 'text-[var(--c-muted)]')
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export function MonthNav({
  monthKey,
  onChange,
  children,
}: {
  monthKey: string;
  onChange: (monthKey: string) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-[var(--c-line)] bg-[var(--c-panel)] px-3 py-2">
      <button type="button" aria-label="前の月" onClick={() => onChange(addMonths(monthKey, -1))}>
        ◀
      </button>
      <strong data-testid="month">{formatMonth(monthKey)}</strong>
      <button type="button" aria-label="次の月" onClick={() => onChange(addMonths(monthKey, 1))}>
        ▶
      </button>
      {children}
    </div>
  );
}
