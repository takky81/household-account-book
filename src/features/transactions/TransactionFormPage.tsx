/**
 * 取引の入力と編集（決定表「取引の入力と編集」）。
 *
 * 共有範囲は取引が持つ（§2.4）。カテゴリは全ユーザー共通で、共有範囲を決めない。
 * 共有範囲を選ぶと負担の既定按分が決まる。既定は「個人」。
 * 手で直した負担はそのまま保存し、以後は自動で戻さない。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Card, ErrorText, Field, FieldGroup, Tabs, TextInput } from '../../components/ui';
import {
  evaluateExpression,
  formatAmount,
  isAmountComputed,
  parseAmountInput,
} from '../../lib/money';
import { todayIso, weekdayOf } from '../../lib/date';
import { defaultSplits, fillRemainder, type Split } from '../../lib/split';
import { saveTransaction, type Transaction } from '../../lib/db';
import { supabase } from '../../lib/supabase';
import { useAuth, useWorkspace } from '../app/context';
import { validateTransaction } from './validation';
import { scopeKey, type Kind } from '../categories/name';
import { selectableCategories } from '../categories/tree';

const SHARED = '__shared__';

/** 金額欄に入れられる演算子。見た目は読みやすい記号、入れるのは計算に使う文字 */
const OPERATORS = [
  { label: '＋', insert: '+' },
  { label: '−', insert: '-' },
  { label: '×', insert: '*' },
  { label: '÷', insert: '/' },
  { label: '(', insert: '(' },
  { label: ')', insert: ')' },
  { label: '.', insert: '.' },
];

export function TransactionFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const workspace = useWorkspace();
  const { userId } = useAuth();
  const selfId = userId!;

  const [kind, setKind] = useState<Kind>('expense');
  const [occurredOn, setOccurredOn] = useState(todayIso());
  const [categoryId, setCategoryId] = useState('');
  /** 共有範囲。既定は先頭＝個人（§2.4） */
  const [scopeKeyValue, setScopeKeyValue] = useState(workspace.scopes[0]?.key ?? '');
  const [amountText, setAmountText] = useState('');
  const [payer, setPayer] = useState<string>(selfId);
  const [manualSplits, setManualSplits] = useState<Split[] | null>(null);
  const [memo, setMemo] = useState('');
  /** 編集で読み込んだときの支払者。変わっていなければメンバー検査を省く（列11） */
  const [loadedPayer, setLoadedPayer] = useState<string | null>(null);
  const [error, setError] = useState('');
  /** 保存を押したときに式が計算できなかったか。直したらすぐ消す（列17） */
  const [amountWarned, setAmountWarned] = useState(false);
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  /** 続けて入力するとき、次の入力へすぐ移れるように金額へ戻す（列13） */
  const amountRef = useRef<HTMLInputElement>(null);

  const category = workspace.categories.find((c) => c.id === categoryId) ?? null;
  const scope = workspace.scopes.find((s) => s.key === scopeKeyValue) ?? workspace.scopes[0] ?? null;
  const isPersonal = scope !== null && scope.shareGroupId === null;
  const members = useMemo(
    () => (scope?.shareGroupId != null ? workspace.membersOf(scope.shareGroupId) : []),
    [scope?.shareGroupId, workspace],
  );
  const memberIds = isPersonal ? [selfId] : members.map((m) => m.userId);
  const amount = parseAmountInput(amountText) ?? 0;
  const payerId = payer === SHARED ? null : payer;

  // 既定の負担。カテゴリ・金額・支払者が変わるたびに引き直す（§5.1）
  const autoSplits = useMemo(
    () =>
      category === null || scope === null || amount <= 0
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
            ownerId: isPersonal ? scope.ownerId : null,
          }),
    [category, scope, amount, members, payerId, isPersonal],
  );
  const splits = manualSplits ?? autoSplits;

  // 既定のカテゴリを初期値にする（設定画面で選べる）
  useEffect(() => {
    if (id !== undefined || categoryId !== '') return;
    const preferred = workspace.profiles.find((p) => p.id === selfId)?.default_category_id ?? null;
    const usable = selectableCategories(workspace.tree.filter((c) => c.kind === kind));
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
      setScopeKeyValue(scopeKey(tx.share_group_id, tx.owner_id));
      setOccurredOn(tx.occurred_on);
      setAmountText(String(tx.amount));
      setPayer(tx.payer_id ?? SHARED);
      setMemo(tx.memo);
      setLoadedPayer(tx.payer_id ?? SHARED);
      if (tx.splits_are_manual) {
        // 読み込んだ順は決まらないので、既定の按分と同じ並び（メンバーの順、
        // 脱退した人は後ろ）に直す。そうしないと開くたびに行が入れ替わる
        const order = new Map(
          (tx.share_group_id !== null ? workspace.membersOf(tx.share_group_id) : []).map(
            (m, index) => [m.userId, index],
          ),
        );
        const rank = (userId: string) => order.get(userId) ?? order.size;
        setManualSplits(
          tx.transaction_splits
            .map((s) => ({ userId: s.user_id, amount: s.amount }))
            .sort((a, b) => rank(a.userId) - rank(b.userId) || (a.userId < b.userId ? -1 : 1)),
        );
      }
    })();
  }, [id, workspace.categories]);

  // 個人の共有範囲の支払者は本人だけ（列4）
  useEffect(() => {
    if (isPersonal && payer !== selfId) setPayer(selfId);
  }, [isPersonal, payer, selfId]);

  // 親がアーカイブ済みなら小分類も候補から外す（§3.4.1）。並びは大分類の直後に小分類
  const categoriesOfKind = useMemo(
    () => selectableCategories(workspace.tree.filter((c) => c.kind === kind)),
    [workspace.tree, kind],
  );

  // 式か小数のときだけ計算結果を欄の下に出す。ただの数字なら何も出さない（列16）
  // 計算できない間は入力の途中でもあるので、保存を押すまでは何も出さない（列17）
  const isComputed = amountText.trim() !== '' && isAmountComputed(amountText);
  const exact = isComputed ? evaluateExpression(amountText) : null;
  const amountBroken = !isComputed || amount <= 0 || exact === null;
  const amountHint = amountBroken ? (
    amountWarned ? <span className="text-[var(--c-warn)]">計算できません</span> : undefined
  ) : (
    `= ${formatAmount(amount)}${Number.isInteger(exact) ? '' : '（四捨五入）'}`
  );

  /** 金額欄を書き換える。計算できる形に直った時点で警告を消す（列17） */
  function changeAmount(next: string) {
    setAmountText(next);
    setManualSplits(null);
    if (parseAmountInput(next) !== null) setAmountWarned(false);
  }

  /** 演算子をカーソル位置に入れる。入力欄の外のボタンから呼ぶ（列16） */
  function insertIntoAmount(text: string) {
    const input = amountRef.current;
    const start = input?.selectionStart ?? amountText.length;
    const end = input?.selectionEnd ?? start;
    changeAmount(amountText.slice(0, start) + text + amountText.slice(end));
    if (input === null) return;
    input.focus();
    // 値の反映後にカーソルを入れた文字の後ろへ動かす
    requestAnimationFrame(() => input.setSelectionRange(start + text.length, start + text.length));
  }

  async function save(again: boolean) {
    setError('');
    setSaved('');
    const parsed = parseAmountInput(amountText);
    if (category === null || parsed === null) {
      if (parsed === null && isAmountComputed(amountText)) setAmountWarned(true);
      setError(
        category !== null && isAmountComputed(amountText)
          ? '金額を計算できません'
          : 'カテゴリと金額を入れてください',
      );
      return;
    }
    if (scope === null) {
      setError('共有範囲を選んでください');
      return;
    }
    const check = validateTransaction({
      amount: parsed,
      isPersonal,
      ownerId: scope.ownerId,
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
        shareGroupId: scope.shareGroupId,
        ownerId: scope.ownerId,
        occurredOn,
        amount: parsed,
        payerId,
        memo,
        splits: manualSplits ?? undefined,
      });
      if (again) {
        // 続けて入力する。日付とカテゴリは引き継ぎ、金額と備考は空にする（列13）
        setAmountText('');
        setAmountWarned(false);
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
        <div className="flex items-center gap-2">
          <TextInput
            type="date"
            value={occurredOn}
            onChange={(e) => setOccurredOn(e.target.value)}
          />
          {occurredOn !== '' && (
            <span className="text-sm text-[var(--c-muted)]">{weekdayOf(occurredOn)}曜日</span>
          )}
        </div>
      </Field>

      {/* 共有範囲はカテゴリと別に選ぶ。既定は個人（§2.4） */}
      <FieldGroup label="共有範囲">
        <Tabs
          label="共有範囲"
          value={scopeKeyValue}
          onChange={(next) => {
            setScopeKeyValue(next);
            setManualSplits(null);
          }}
          options={workspace.scopes.map((s) => ({ value: s.key, label: s.label }))}
        />
      </FieldGroup>

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
              {workspace.categoryPath(c.id)}
            </option>
          ))}
        </select>
      </Field>

      <Field label="金額" hint={amountHint}>
        <TextInput
          ref={amountRef}
          // iPhone の数字キーボードに小数点を出すため（列16）。演算子は下のボタンで入れる
          inputMode="decimal"
          aria-label="金額"
          value={amountText}
          onChange={(e) => changeAmount(e.target.value)}
        />
      </Field>

      {/* スマホの数字キーボードには演算子が無いので、押して入れられるようにする（列16）。
          小数点は inputMode="decimal" でキーボードにも出るが、並びを揃えてここにも置く */}
      <div className="flex gap-1">
        {OPERATORS.map((op) => (
          <Button
            key={op.insert}
            variant="ghost"
            aria-label={op.label}
            className="w-9 px-0 text-center"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => insertIntoAmount(op.insert)}
          >
            {op.label}
          </Button>
        ))}
      </div>

      {!isPersonal && members.length > 0 && (
        <FieldGroup label="支払者">
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
        </FieldGroup>
      )}

      {/* 個人の負担は本人1行＝全額に決まり、他の値は保存できない（§3.6）ので出さない */}
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
    </main>
  );
}
