import { ChevronDown, ChevronLeft } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { categoryPath, orderedTree, type TreeCategory } from '../categories/tree';

export function CategoryPicker({
  categories,
  value,
  onChange,
}: {
  categories: TreeCategory[];
  value: string;
  onChange: (categoryId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeRootId, setActiveRootId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const tree = useMemo(() => orderedTree(categories), [categories]);
  const selected = categories.find((category) => category.id === value) ?? null;
  const activeBranch = tree.find(({ root }) => root.id === activeRootId) ?? null;

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus());
  }, [open, activeRootId]);

  function choose(categoryId: string) {
    onChange(categoryId);
    setOpen(false);
    setActiveRootId(null);
    triggerRef.current?.focus();
  }

  const itemClass =
    'flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-[var(--c-hover)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--c-ink)]';

  return (
    <div className="relative" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        aria-label="カテゴリ"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-[var(--c-edge)] bg-[var(--c-panel)] px-2 py-1.5 text-sm text-[var(--c-ink)]"
        onClick={() => {
          setActiveRootId(null);
          setOpen((current) => !current);
        }}
      >
        <span>{selected === null ? '選んでください' : categoryPath(categories, selected)}</span>
        <ChevronDown aria-hidden size={16} className="shrink-0" />
      </button>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="カテゴリの選択肢"
          className="absolute top-full right-0 left-0 z-30 mt-1 max-h-80 overflow-y-auto rounded-lg border border-[var(--c-line)] bg-[var(--c-panel)] p-1 shadow-lg"
        >
          {activeBranch === null ? (
            tree.length === 0 ? (
              <p className="px-3 py-2 text-sm text-[var(--c-muted)]">選べるカテゴリがありません</p>
            ) : (
              tree.map(({ root, children }) => (
                <button
                  key={root.id}
                  type="button"
                  role="menuitem"
                  aria-current={selected?.id === root.id ? 'true' : undefined}
                  className={itemClass}
                  onClick={() => {
                    if (children.length === 0) choose(root.id);
                    else {
                      // 小カテゴリへ進む時点で大カテゴリを選択済みにする。
                      // このままメニューを閉じても、大カテゴリそのものへ記録できる。
                      onChange(root.id);
                      setActiveRootId(root.id);
                    }
                  }}
                >
                  <span>{root.name}</span>
                  {children.length > 0 && (
                    <span aria-hidden className="text-[var(--c-muted)]">
                      ›
                    </span>
                  )}
                </button>
              ))
            )
          ) : (
            <>
              <button
                type="button"
                role="menuitem"
                className={itemClass}
                onClick={() => setActiveRootId(null)}
              >
                <span className="flex items-center gap-1 text-[var(--c-muted)]">
                  <ChevronLeft aria-hidden size={16} />
                  大カテゴリへ戻る
                </span>
              </button>
              <div className="my-1 border-t border-[var(--c-line)]" />
              <button
                type="button"
                role="menuitem"
                aria-current={selected?.id === activeBranch.root.id ? 'true' : undefined}
                className={itemClass}
                onClick={() => choose(activeBranch.root.id)}
              >
                <span>{activeBranch.root.name}（大カテゴリ）</span>
              </button>
              {activeBranch.children.map((child) => (
                <button
                  key={child.id}
                  type="button"
                  role="menuitem"
                  aria-current={selected?.id === child.id ? 'true' : undefined}
                  className={itemClass}
                  onClick={() => choose(child.id)}
                >
                  <span>{child.name}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
