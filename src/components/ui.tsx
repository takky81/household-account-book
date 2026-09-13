/**
 * 画面の部品。見た目は design/wireframes.html を正とし、色は src/index.css の変数だけを使う。
 */

import { useEffect } from 'react';
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

/**
 * 消す前の確認（決定表「表示設定と共通の振る舞い」列9・列10）。
 *
 * window.confirm / window.alert は使わない。端末によって見た目も文言の置き場所も
 * 変わり、配色もダークモードに追従しないので、画面の部品として同じ形で出す。
 * 既定の焦点は「やめる」に置く。Enter の連打や誤タップで消えないようにする。
 *
 * detail は1要素=1行。「何が消えるか」と「そのあとどうなるか」を別の行に置く。
 * 一続きの長文にすると、狭い画面では文の途中で折り返されて読み取りにくい。
 * 行の中の折り返しも、対応する端末では文節で切る（word-break: auto-phrase）。
 */
export function ConfirmDialog({
  title,
  detail,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  detail?: string[];
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--c-overlay)] p-4"
      // 枠の外を押したときもやめる扱いにする。消す操作を暴発させない側に倒す
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex w-full max-w-xs flex-col gap-2 rounded-lg border border-[var(--c-line)] bg-[var(--c-panel)] p-3 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-bold text-pretty [word-break:auto-phrase]">{title}</p>
        {detail !== undefined && (
          <div className="flex flex-col gap-1 text-xs text-[var(--c-muted)]">
            {detail.map((line) => (
              <p key={line} className="text-pretty [word-break:auto-phrase]">
                {line}
              </p>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" autoFocus onClick={onCancel}>
            やめる
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-[var(--c-muted)]">{label}</span>
      {children}
      {hint !== undefined && <span className="text-xs text-[var(--c-muted)]">{hint}</span>}
    </label>
  );
}

/**
 * ラベルつきの囲い。中身が Tabs のような操作部品のときはこちらを使う。
 * Field は <label> なので、中の最初のボタンにラベルの文字が名前として移ってしまい、
 * 「共有範囲 共有範囲」のような読み上げ名になる。
 */
export function FieldGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-[var(--c-muted)]">{label}</span>
      {children}
    </div>
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
