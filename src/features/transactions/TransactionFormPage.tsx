/**
 * 取引の入力と編集（決定表「取引の入力と編集」）。
 *
 * カテゴリを選ぶと共有範囲が決まり、負担の既定按分もそれで決まる。
 * 手で直した負担はそのまま保存し、以後は自動で戻さない。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Card, ErrorText, Field, Note, ScopeTag, Tabs, TextInput } from '../../components/ui';
import { formatAmount, parseAmount } from '../../lib/money';
import { todayIso } from '../../lib/date';
import { defaultSplits, fillRemainder, type Split } from '../../lib/split';
import { saveTransaction, type Transaction } from '../../lib/db';
import { supabase } from '../../lib/supabase';
import { useAuth, useWorkspace } from '../app/context';
import { validateTransaction } from './validation';
import type { Kind } from '../categories/name';

const SHARED = '__shared__';

export function TransactionFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const workspace = useWorkspace();
  const { userId } = useAuth();
  const selfId = userId!;

  const [kind, setKind] = useState<Kind>('expense');
  const [occurredOn, setOccurredOn] = useState(todayIso());
  const [categoryId, setCategoryId] = useState('');
  const [amountText, setAmountText] = useState('');
  const [payer, setPayer] = useState<string>(selfId);
  const [manualSplits, setManualSplits] = useState<Split[] | null>(null);
  const [memo, setMemo] = useState('');
  /** 編集で読み込んだときの支払者。変わっていなければメンバー検査を省く（列11） */
  const [loadedPayer, setLoadedPayer] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  /** 続けて入力するとき、次の入力へすぐ移れるように金額へ戻す（列13） */
  const amountRef = useRef<HTMLInputElement>(null);

  const category = workspace.categories.find((c) => c.id === categoryId) ?? null;
  const isPersonal = category !== null && category.share_group_id === null;
  const members = useMemo(
    () => (category?.share_group_id != null ? workspace.membersOf(category.share_group_id) : []),
    [category?.share_group_id, workspace],
  );
  const memberIds = isPersonal ? [selfId] : members.map((m) => m.userId);
  const amount = parseAmount(amountText) ?? 0;
  const payerId = payer === SHARED ? null : payer;

  // 既定の負担。カテゴリ・金額・支払者が変わるたびに引き直す（§5.1）
  const autoSplits = useMemo(
    () =>
      category === null || amount <= 0
        ? []
        : defaultSplits({
            members: members.map((m) => ({
              userId: m.userId,
              weight: m.defaultWeight,
              sortOrder: m.sortOrder,
            })),
            amount,
            kind: category.kind,
            payerId,
            ownerId: isPersonal ? category.owner_id : null,
          }),
    [category, amount, members, payerId, isPersonal],
  );
  const splits = manualSplits ?? autoSplits;

  // 既定のカテゴリを初期値にする（設定画面で選べる）
  useEffect(() => {
    if (id !== undefined || categoryId !== '') return;
    const preferred = workspace.profiles.find((p) => p.id === selfId)?.default_category_id ?? null;
    const usable = workspace.categories.filter((c) => c.kind === kind && !c.is_archived);
    const next = usable.find((c) => c.id === preferred) ?? usable[0];
    if (next !== undefined) setCategoryId(next.id);
  }, [id, categoryId, kind, workspace, selfId]);

  // 編集のときは読み直す
  useEffect(() => {
    if (id === undefined) return;
    void (async () => {
      const { data } = await supabase
        .from('transactions')
        .select('*, transaction_splits(user_id, amount)')
        .eq('id', id)
        .single();
      const tx = data as Transaction | null;
      if (tx === null) return;
      const found = workspace.categories.find((c) => c.id === tx.category_id);
      setKind(found?.kind ?? 'expense');
      setCategoryId(tx.category_id);
      setOccurredOn(tx.occurred_on);
      setAmountText(String(tx.amount));
      setPayer(tx.payer_id ?? SHARED);
      setMemo(tx.memo);
      setLoadedPayer(tx.payer_id ?? SHARED);
      if (tx.splits_are_manual) {
        setManualSplits(tx.transaction_splits.map((s) => ({ userId: s.user_id, amount: s.amount })));
      }
    })();
  }, [id, workspace.categories]);

  // 個人カテゴリの支払者は本人だけ（列4）
  useEffect(() => {
    if (isPersonal && payer !== selfId) setPayer(selfId);
  }, [isPersonal, payer, selfId]);

  const categoriesOfKind = workspace.categories.filter((c) => c.kind === kind && !c.is_archived);

  async function save(again: boolean) {
    setError('');
    setSaved('');
    const parsed = parseAmount(amountText);
    if (category === null || parsed === null) {
      setError('カテゴリと金額を入れてください');
      return;
    }
    const check = validateTransaction({
      amount: parsed,
      isPersonal,
      ownerId: category.owner_id,
      payerId,
      memberIds,
      splits,
      payerUnchanged: loadedPayer === payer,
    });
    if (!check.ok) {
      setError(check.message);
      return;
    }
    if (busy) return; // 二重送信を捨てる（表示設定 列4）
    setBusy(true);
    try {
      await saveTransaction({
        id,
        categoryId: category.id,
        occurredOn,
        amount: parsed,
        payerId,
        memo,
        splits: manualSplits ?? undefined,
      });
      if (again) {
        // 続けて入力する。日付とカテゴリは引き継ぎ、金額と備考は空にする（列13）
        setAmountText('');
        setMemo('');
        setManualSplits(null);
        setSaved('保存しました');
        amountRef.current?.focus();
      } else {
        navigate('/transactions');
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '保存できませんでした');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-3 p-3">
      <h1 className="text-lg font-bold">{id === undefined ? '取引を入力' : '取引を編集'}</h1>

      <Tabs
        label="収支"
        value={kind}
        onChange={(next) => {
          setKind(next);
          setCategoryId('');
          setManualSplits(null);
        }}
        options={[
          { value: 'expense', label: '支出' },
          { value: 'income', label: '収入' },
        ]}
      />

      <Field label="日付">
        <TextInput
          type="date"
          value={occurredOn}
          onChange={(e) => setOccurredOn(e.target.value)}
        />
      </Field>

      <Field label="カテゴリ">
        <select
          aria-label="カテゴリ"
          className="rounded-md border border-[var(--c-edge)] bg-[var(--c-panel)] px-2 py-1.5 text-sm"
          value={categoryId}
          onChange={(e) => {
            setCategoryId(e.target.value);
            setManualSplits(null);
          }}
        >
          <option value="">選んでください</option>
          {categoriesOfKind.map((c) => (
            <option key={c.id} value={c.id}>
              {workspace.scopeLabel(c)} / {c.name}
            </option>
          ))}
        </select>
      </Field>

      {category !== null && (
        <div className="flex items-center gap-2 text-xs">
          <ScopeTag
            label={workspace.scopeLabel(category)}
            kind={category.share_group_id === null ? 'own' : 'group'}
          />
          <span className="text-[var(--c-muted)]">共有範囲はカテゴリが決める</span>
        </div>
      )}

      <Field label="金額">
        <TextInput
          ref={amountRef}
          inputMode="numeric"
          aria-label="金額"
          value={amountText}
          onChange={(e) => {
            setAmountText(e.target.value);
            setManualSplits(null);
          }}
        />
      </Field>

      {!isPersonal && members.length > 0 && (
        <Field label="支払者">
          <Tabs
            label="支払者"
            value={payer}
            onChange={(next) => {
              setPayer(next);
              setManualSplits(null);
            }}
            options={[
              ...members.map((m) => ({
                value: m.userId,
                label: workspace.displayName(m.userId),
              })),
              { value: SHARED, label: '共用' },
            ]}
          />
        </Field>
      )}

      {/* 個人カテゴリの負担は本人1行＝全額に決まり、他の値は保存できない（§3.6）ので出さない */}
      {!isPersonal && splits.length > 0 && (
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-bold">負担</h2>
            <Button variant="ghost" className="text-xs" onClick={() => setManualSplits(null)}>
              既定に戻す
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            {splits.map((split) => (
              <div key={split.userId} className="flex items-center justify-between gap-2">
                <span className="text-sm">{workspace.displayName(split.userId)}</span>
                <TextInput
                  aria-label={`${workspace.displayName(split.userId)}の負担`}
                  inputMode="numeric"
                  className="w-28 text-right"
                  value={String(split.amount)}
                  onChange={(e) => {
                    const next = Number(e.target.value.replace(/[^\d-]/g, '')) || 0;
                    setManualSplits(
                      splits.map((s) => (s.userId === split.userId ? { ...s, amount: next } : s)),
                    );
                  }}
                />
              </div>
            ))}
            <div className="flex items-center justify-between text-xs text-[var(--c-muted)]">
              <span>合計</span>
              <span data-testid="splits-total">
                {formatAmount(splits.reduce((sum, s) => sum + s.amount, 0))} / {formatAmount(amount)}
              </span>
            </div>
            {manualSplits !== null && members.length > 1 && (
              <Button
                variant="ghost"
                className="text-xs"
                onClick={() => {
                  // 1人ぶんだけ入れて残りを自動で埋める（列14）
                  const fixed = manualSplits.slice(0, 1);
                  setManualSplits(
                    fillRemainder(
                      members.map((m) => ({
                        userId: m.userId,
                        weight: m.defaultWeight,
                        sortOrder: m.sortOrder,
                      })),
                      amount,
                      fixed,
                    ),
                  );
                }}
              >
                残りを自動で埋める
              </Button>
            )}
          </div>
        </Card>
      )}

      <Field label="備考">
        <TextInput value={memo} onChange={(e) => setMemo(e.target.value)} />
      </Field>

      <ErrorText>{error}</ErrorText>
      {saved !== '' && <p className="text-xs text-[var(--c-income)]">{saved}</p>}

      <div className="flex gap-2">
        {/* 続けて入力できるのは新規のときだけ。編集で押すと同じ取引を上書きし続けてしまう */}
        {id === undefined && (
          <Button variant="ghost" className="flex-1" disabled={busy} onClick={() => void save(true)}>
            保存して続けて入力
          </Button>
        )}
        <Button className="flex-1" disabled={busy} onClick={() => void save(false)}>
          保存
        </Button>
      </div>

      <Note>
        個人カテゴリの支払者は本人だけ。共用は共有カテゴリでだけ選べる（§3.5）
      </Note>
    </main>
  );
}
