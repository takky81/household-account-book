/** 画面の外枠。下部のナビと、対象月の前後移動を持つ。 */

import { NavLink, Outlet } from 'react-router-dom';
import { addMonths, formatMonth } from '../../lib/date';
import { useNarrow } from '../../lib/useNarrow';
import { cn } from '../../lib/utils';

const NAV = [
  { to: '/', label: 'ホーム', end: true },
  { to: '/new', label: '入力', end: false },
  { to: '/transactions', label: '一覧', end: false },
  { to: '/aggregate', label: '集計', end: false },
  { to: '/budget', label: '予算', end: false },
  { to: '/settings', label: '設定', end: false },
];

/** 端末下端のホームバー／ブラウザのバーと重ならないよう空ける余白。 */
const SAFE_BOTTOM = 'max(env(safe-area-inset-bottom), 0.75rem)';

export function Layout() {
  // スマートフォンでの入力を主用途とする。狭いときは親指の届く下、広いときは上に置く（列3 / §6）
  const narrow = useNarrow();
  const renderLinks = (itemClass: string) =>
    NAV.map((item) => (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.end}
        className={({ isActive }) =>
          cn(itemClass, isActive ? 'font-bold text-[var(--c-ink)]' : 'text-[var(--c-muted)]')
        }
      >
        {item.label}
      </NavLink>
    ));

  return (
    <div
      className="min-h-screen"
      // 下ナビの高さぶん本文を空ける（固定配置なので場所を取らない）
      style={narrow ? { paddingBottom: `calc(3.25rem + ${SAFE_BOTTOM})` } : undefined}
    >
      {!narrow && (
        <nav
          data-testid="nav-top"
          className="sticky top-0 z-10 flex justify-center gap-4 border-b border-[var(--c-line)] bg-[var(--c-panel)] py-2 text-sm"
        >
          {renderLinks('px-2')}
        </nav>
      )}
      <Outlet />
      {narrow && (
        <nav
          data-testid="nav-bottom"
          className="fixed inset-x-0 bottom-0 flex justify-around border-t border-[var(--c-line)] bg-[var(--c-panel)] pt-2 text-xs"
          // 画面の最下端はブラウザのバーを呼び出す領域なので、リンクをそこまで広げない
          style={{ paddingBottom: SAFE_BOTTOM }}
        >
          {renderLinks('flex flex-1 items-center justify-center px-2 py-1.5')}
        </nav>
      )}
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
