import { ChevronRight, PackageCheck, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/utils';

export function SupplyBanner({
  count,
  loading = false,
  failed = false,
}: {
  count: number;
  loading?: boolean;
  failed?: boolean;
}) {
  const hasMissing = !loading && !failed && count > 0;
  const detail = loading
    ? 'を確認中…'
    : failed
      ? 'を確認できませんでした'
      : hasMissing
        ? `が${count}件あります`
        : 'はありません';
  return (
    <Link
      to="/supplies"
      aria-label={`不足物資${detail}。編集する`}
      className={cn(
        'relative flex min-h-11 items-center justify-between overflow-hidden rounded-lg border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2',
        hasMissing
          ? 'supply-alert-active border-[var(--c-supply)] bg-[var(--c-supply-panel)] text-[var(--c-supply)]'
          : 'border-[var(--c-line)] bg-[var(--c-panel)] text-[var(--c-muted)]',
      )}
    >
      <span className="relative z-1 flex items-center gap-2">
        {hasMissing ? <Sparkles aria-hidden="true" size={18} /> : <PackageCheck aria-hidden="true" size={18} />}
        <span>
          <strong className="font-bold">不足物資</strong>
          <span className="ml-2">{detail}</span>
        </span>
      </span>
      <ChevronRight className="relative z-1 shrink-0" aria-hidden="true" size={18} />
    </Link>
  );
}
