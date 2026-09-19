import { useState, type FormEvent } from 'react';
import { Check, Circle, PackageOpen, Plus, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button, Card, ConfirmDialog, ErrorText, Note, TextInput } from '../../components/ui';
import type { MissingSupply } from '../../lib/db';
import { cn } from '../../lib/utils';
import { missingCount } from './model';
import { useSupplies } from './useSupplies';

export function SuppliesPage() {
  const supplies = useSupplies();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<MissingSupply | null>(null);
  const count = missingCount(supplies.items);

  async function add(event: FormEvent) {
    event.preventDefault();
    if (name.trim() === '' || busy) return;
    setBusy(true);
    const saved = await supplies.add(name);
    setBusy(false);
    if (saved) setName('');
  }

  async function toggle(item: MissingSupply) {
    if (busy) return;
    setBusy(true);
    await supplies.toggle(item);
    setBusy(false);
  }

  async function remove() {
    if (pendingRemove === null || busy) return;
    setBusy(true);
    await supplies.remove(pendingRemove.id);
    setBusy(false);
    setPendingRemove(null);
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-3 p-3">
      <div className="flex items-center gap-2">
        <Link className="inline-flex min-h-11 items-center text-sm text-[var(--c-link)]" to="/">
          ← ホーム
        </Link>
        <h1 className="text-lg font-bold">不足物資</h1>
      </div>

      <ErrorText>{supplies.error}</ErrorText>

      <Card className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-sm font-bold">
            <PackageOpen aria-hidden="true" size={20} />
            買うもの
          </span>
          <span className="rounded-full bg-[var(--c-supply-panel)] px-2 py-0.5 text-xs font-bold text-[var(--c-supply)]">
            残り {count}件
          </span>
        </div>

        <form className="flex gap-2" onSubmit={add}>
          <TextInput
            aria-label="不足物資を追加"
            className="min-w-0 flex-1"
            placeholder="例：牛乳"
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Button
            type="submit"
            disabled={name.trim() === '' || busy}
            className="inline-flex items-center gap-1"
          >
            <Plus aria-hidden="true" size={16} />
            追加
          </Button>
        </form>

        {supplies.loading ? (
          <p className="py-6 text-center text-sm text-[var(--c-muted)]">読み込んでいます…</p>
        ) : supplies.items.length === 0 ? (
          <p className="rounded-md bg-[var(--c-subtle)] px-3 py-6 text-center text-sm text-[var(--c-muted)]">
            不足している物資はありません
          </p>
        ) : (
          <ul className="divide-y divide-[var(--c-line)]">
            {supplies.items.map((item) => (
              <li key={item.id} className="flex min-h-12 items-center gap-2 py-2">
                <button
                  type="button"
                  aria-label={`${item.name}を${item.is_purchased ? '不足中に戻す' : '購入済みにする'}`}
                  aria-pressed={item.is_purchased}
                  className={cn(
                    'inline-flex size-9 shrink-0 items-center justify-center rounded-full border',
                    item.is_purchased
                      ? 'border-[var(--c-income)] bg-[var(--c-income)] text-[var(--c-panel)]'
                      : 'border-[var(--c-edge)] text-[var(--c-muted)]',
                  )}
                  disabled={busy}
                  onClick={() => void toggle(item)}
                >
                  {item.is_purchased ? (
                    <Check aria-hidden="true" size={18} />
                  ) : (
                    <Circle aria-hidden="true" size={18} />
                  )}
                </button>
                <span
                  className={cn(
                    'min-w-0 flex-1 text-sm',
                    item.is_purchased && 'text-[var(--c-muted)] line-through',
                  )}
                >
                  {item.name}
                </span>
                {item.is_purchased && (
                  <span className="text-xs text-[var(--c-muted)]">購入済み</span>
                )}
                <button
                  type="button"
                  aria-label={`${item.name}を削除`}
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-[var(--c-muted)] hover:bg-[var(--c-hover)] hover:text-[var(--c-warn)]"
                  disabled={busy}
                  onClick={() => setPendingRemove(item)}
                >
                  <Trash2 aria-hidden="true" size={17} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Note>追加・購入済み・削除は、ログインしているすべてのメンバーに共有されます</Note>

      {pendingRemove !== null && (
        <ConfirmDialog
          title={`「${pendingRemove.name}」を削除しますか`}
          detail={['不足物資の共有リストから削除されます', 'ほかのメンバーの画面からも消えます']}
          confirmLabel="削除する"
          onConfirm={() => void remove()}
          onCancel={() => setPendingRemove(null)}
        />
      )}
    </main>
  );
}
