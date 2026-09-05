/**
 * 画面の部品。見た目は design/wireframes.html を正とし、色は src/index.css の変数だけを使う。
 */

import type { ButtonHTMLAttributes, ComponentProps, ReactNode, SelectHTMLAttributes } from 'react';
import { cn } from '../lib/utils';

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cn(
        'rounded-lg border border-[var(--c-line)] bg-[var(--c-panel)] p-3',
        className,
      )}
    >
      {children}
    </section>
  );
}

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  return (
    <button
      type="button"
      className={cn(
        'rounded-md px-3 py-1.5 text-sm disabled:opacity-40',
        variant === 'primary' && 'bg-[var(--c-ink)] text-[var(--c-paper)]',
        variant === 'ghost' && 'border border-[var(--c-edge)] bg-[var(--c-panel)]',
        variant === 'danger' && 'border border-[var(--c-warn)] text-[var(--c-warn)]',
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-[var(--c-muted)]">{label}</span>
      {children}
      {hint !== undefined && <span className="text-xs text-[var(--c-muted)]">{hint}</span>}
    </label>
  );
}

const inputClass =
  'rounded-md border border-[var(--c-edge)] bg-[var(--c-panel)] px-2 py-1.5 text-sm text-[var(--c-ink)]';

export function TextInput({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(inputClass, className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(inputClass, className)} {...props} />;
}

/** 共有範囲の印。グループなら名前、個人なら「個人」。 */
export function ScopeTag({ label, kind }: { label: string; kind: 'group' | 'own' }) {
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-xs whitespace-nowrap',
        kind === 'group'
          ? 'bg-[var(--c-shared-panel)] text-[var(--c-shared)]'
          : 'bg-[var(--c-own-panel)] text-[var(--c-own)]',
      )}
    >
      {label}
    </span>
  );
}

export function Meter({ rate, over }: { rate: number | null; over: boolean }) {
  const width = rate === null ? 0 : Math.min(1, rate) * 100;
  return (
    <div className="h-2 overflow-hidden rounded-full bg-[var(--c-bar-track)]">
      <div
        className={cn('h-full', over ? 'bg-[var(--c-warn)]' : 'bg-[var(--c-bar)]')}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

export function Tabs<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-full border px-3 py-0.5 text-xs',
            option.value === value
              ? 'border-[var(--c-ink)] bg-[var(--c-ink)] text-[var(--c-paper)]'
              : 'border-[var(--c-edge)] bg-[var(--c-panel)]',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <p
      role="alert"
      className="rounded-md border border-[var(--c-warn)] bg-[var(--c-warn-panel)] px-2 py-1 text-xs text-[var(--c-warn)]"
    >
      {children}
    </p>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <p className="border-l-2 border-[var(--c-edge)] pl-2 text-xs text-[var(--c-muted)]">
      {children}
    </p>
  );
}
