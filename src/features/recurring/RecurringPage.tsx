/**
 * 定期登録管理画面（決定表「定期登録ルールの管理」／§6）。
 *
 * 毎月・固定額のルールだけを扱う（§3.8）。生成そのものは起動時に走るので、
 * ここでは次にいつ登録されるかと、実行できないルールを見せる。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  ConfirmDialog,
  ErrorText,
  Field,
  FieldGroup,
  Note,
  ScopeTag,
  Tabs,
  TextInput,
} from '../../components/ui';
import { currentMonthKey, formatDay, todayIso } from '../../lib/date';
import { formatAmount, parseAmount } from '../../lib/money';
import { defaultSplits, type Split } from '../../lib/split';
import {
  deleteRecurringRule,
  loadRecurringRules,
  saveRecurringRule,
  type RecurringRule,
} from '../../lib/db';
import { useAuth, useWorkspace } from '../app/context';
import { scopeKey } from '../categories/name';
import { selectableCategories } from '../categories/tree';
import { nextDueDate } from './schedule';
import { validateRecurringRule } from './validation';

const SHARED = '__shared__';

/** 月初の日付（DB の形）を対象月（画面の形）へ。 */
function toMonthKey(value: string): string {
  return value.slice(0, 7);
}

type FormState = {
  id?: string;
  categoryId: string;
  /** 共有範囲（§2.4）。カテゴリではなくルールが持つ */
  scopeKey: string;
  amountText: string;
  dayText: string;
  startMonth: string;
  endMonth: string;
  payer: string;
  memo: string;
  splits: Split[] | null;
};

function emptyForm(selfId: string, scopeKey: string): FormState {
  return {
    categoryId: '',
    scopeKey,
    amountText: '',
    dayText: '1',
    startMonth: currentMonthKey(),
    endMonth: '',
    payer: selfId,
    memo: '',
    splits: null,
  };
}

export function RecurringPage() {
  const workspace = useWorkspace();
  const { userId } = useAuth();
  const selfId = userId!;
  const [rules, setRules] = useState<RecurringRule[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  /** 削除を押したルール。確認ダイアログの「削除する」で初めて消す */
  const [pendingRemove, setPendingRemove] = useState<RecurringRule | null>(null);

  const reload = useCallback(async () => {
    setRules(await loadRecurringRules());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const categories = useMemo(
    () => selectableCategories(workspace.tree.filter((c) => !c.isArchived)),
    [workspace.tree],
  );

  const category =
    form === null ? null : (workspace.categories.find((c) => c.id === form.categoryId) ?? null);
  const scope =
    form === null ? null : (workspace.scopes.find((s) => s.key === form.scopeKey) ?? null);
  const isPersonal = scope !== null && scope.shareGroupId === null;
  const members = useMemo(
    () => (scope?.shareGroupId != null ? workspace.membersOf(scope.shareGroupId) : []),
    [scope?.shareGroupId, workspace],
  );
  const amount = form === null ? 0 : (parseAmount(form.amountText) ?? 0);
  const payerId = form === null || form.payer === SHARED ? null : form.payer;

  // 既定の按分。雛形を持たないルールは生成のたびにこの規則で割る（§5.1）
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
  const splits = form?.splits ?? autoSplits;

  function startNew() {
    setError('');
    const first = categories[0];
    setForm({
      ...emptyForm(selfId, workspace.scopes[0]?.key ?? ''),
      categoryId: first?.id ?? '',
    });
  }

  function startEdit(rule: RecurringRule) {
    setError('');
    setForm({
      id: rule.id,
      categoryId: rule.category_id,
      scopeKey: scopeKey(rule.share_group_id, rule.owner_id),
      amountText: String(rule.amount),
      dayText: String(rule.day_of_month),
      startMonth: toMonthKey(rule.start_month),
      endMonth: rule.end_month === null ? '' : toMonthKey(rule.end_month),
      payer: rule.payer_id ?? SHARED,
      memo: rule.memo,
      splits: rule.splits_are_manual
        ? rule.recurring_rule_splits.map((s) => ({ userId: s.user_id, amount: s.amount }))
        : null,
    });
  }

  async function save() {
    if (form === null) return;
    setError('');
    const parsed = parseAmount(form.amountText);
    if (scope === null) {
      setError('共有範囲を選んでください');
      return;
    }
    const input = {
      categoryId: form.categoryId,
      shareGroupId: scope.shareGroupId,
      ownerId: scope.ownerId,
      amount: parsed ?? 0,
      dayOfMonth: Number(form.dayText),
      startMonth: form.startMonth,
      endMonth: form.endMonth === '' ? null : form.endMonth,
      // 個人の負担は本人1行＝全額に決まるので雛形を持たせない（§3.6）
      splits: isPersonal || form.splits === null ? undefined : form.splits,
    };
    const check = validateRecurringRule(input);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      await saveRecurringRule({
        ...input,
        id: form.id,
        payerId: isPersonal ? selfId : payerId,
        memo: form.memo,
        isPaused: rules.find((r) => r.id === form.id)?.is_paused ?? false,
      });
      setForm(null);
      await reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '保存できませんでした');
    } finally {
      setBusy(false);
    }
  }

  async function patch(rule: RecurringRule, next: { isPaused: boolean }) {
    setError('');
    try {
      await saveRecurringRule({
        id: rule.id,
        categoryId: rule.category_id,
        shareGroupId: rule.share_group_id,
        ownerId: rule.owner_id,
        amount: rule.amount,
        dayOfMonth: rule.day_of_month,
        startMonth: toMonthKey(rule.start_month),
        endMonth: rule.end_month === null ? null : toMonthKey(rule.end_month),
        payerId: rule.payer_id,
        memo: rule.memo,
        isPaused: next.isPaused,
        splits: rule.splits_are_manual
          ? rule.recurring_rule_splits.map((s) => ({ userId: s.user_id, amount: s.amount }))
          : undefined,
      });
      await reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '保存できませんでした');
    }
  }

  async function remove(rule: RecurringRule) {
    setError('');
    setPendingRemove(null);
    try {
      await deleteRecurringRule(rule.id);
      await reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '削除できませんでした');
    }
  }

  const today = todayIso();

  return (
    <main className="mx-auto flex max-w-md flex-col gap-3 p-3">
      <h1 className="text-lg font-bold">定期登録</h1>
      <ErrorText>{error}</ErrorText>

      {rules.length === 0 && form === null && (
        <p className="text-xs text-[var(--c-muted)]">まだありません</p>
      )}

      <div className="flex flex-col gap-2">
        {rules.map((rule) => {
          const target = workspace.categories.find((c) => c.id === rule.category_id);
          const next = nextDueDate(
            {
              dayOfMonth: rule.day_of_month,
              startMonth: toMonthKey(rule.start_month),
              endMonth: rule.end_month === null ? null : toMonthKey(rule.end_month),
              isPaused: rule.is_paused,
            },
            today,
          );
          return (
            <div key={rule.id} data-testid="rule">
              <Card className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1 text-sm">
                    {/* 共有範囲はルールが持つ（§2.4） */}
                    <ScopeTag
                      label={workspace.scopeLabel(rule)}
                      kind={rule.share_group_id === null ? 'own' : 'group'}
                    />
                    {workspace.categoryPath(rule.category_id)}
                  </span>
                  <span className="text-sm">{formatAmount(rule.amount)}</span>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs text-[var(--c-muted)]">
                  <span>
                    毎月{rule.day_of_month}日 / {workspace.displayName(rule.payer_id)}
                    {rule.memo === '' ? '' : ` / ${rule.memo}`}
                  </span>
                  <span>
                    {rule.is_paused
                      ? '一時停止中'
                      : next === null
                        ? '次回なし'
                        : `次回 ${formatDay(next)}`}
                  </span>
                </div>
                {target?.is_archived === true && (
                  <p role="alert" className="text-xs text-[var(--c-warn)]">
                    カテゴリがアーカイブされているため登録されません
                  </p>
                )}
                <div className="flex gap-2">
                  <Button variant="ghost" className="text-xs" onClick={() => startEdit(rule)}>
                    編集
                  </Button>
                  <Button
                    variant="ghost"
                    className="text-xs"
                    onClick={() => void patch(rule, { isPaused: !rule.is_paused })}
                  >
                    {rule.is_paused ? '再開' : '一時停止'}
                  </Button>
                  <Button
                    variant="danger"
                    className="text-xs"
                    onClick={() => setPendingRemove(rule)}
                  >
                    削除
                  </Button>
                </div>
              </Card>
            </div>
          );
        })}
      </div>

      {form === null ? (
        <Button onClick={startNew}>＋ ルールを追加</Button>
      ) : (
        <Card className="flex flex-col gap-2">
          <h2 className="text-sm font-bold">
            {form.id === undefined ? 'ルールを追加' : 'ルールを編集'}
          </h2>

          <FieldGroup label="共有範囲">
            <Tabs
              label="共有範囲"
              value={form.scopeKey}
              onChange={(next) => setForm({ ...form, scopeKey: next, splits: null })}
              options={workspace.scopes.map((s) => ({ value: s.key, label: s.label }))}
            />
          </FieldGroup>

          <Field label="カテゴリ">
            <select
              aria-label="カテゴリ"
              className="rounded-md border border-[var(--c-edge)] bg-[var(--c-panel)] px-2 py-1.5 text-sm"
              value={form.categoryId}
              onChange={(e) => setForm({ ...form, categoryId: e.target.value, splits: null })}
            >
              <option value="">選んでください</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {workspace.categoryPath(c.id)}
                </option>
              ))}
            </select>
          </Field>

          <Field label="金額">
            <TextInput
              aria-label="金額"
              inputMode="numeric"
              value={form.amountText}
              onChange={(e) => setForm({ ...form, amountText: e.target.value, splits: null })}
            />
          </Field>

          <Field label="支払日" hint="その月に無い日は月末日に登録します">
            <TextInput
              aria-label="支払日"
              inputMode="numeric"
              value={form.dayText}
              onChange={(e) => setForm({ ...form, dayText: e.target.value })}
            />
          </Field>

          <Field label="開始月">
            <TextInput
              type="month"
              aria-label="開始月"
              value={form.startMonth}
              onChange={(e) => setForm({ ...form, startMonth: e.target.value })}
            />
          </Field>

          <Field label="終了月" hint="空のままなら無期限">
            <TextInput
              type="month"
              aria-label="終了月"
              value={form.endMonth}
              onChange={(e) => setForm({ ...form, endMonth: e.target.value })}
            />
          </Field>

          {!isPersonal && members.length > 0 && (
            <FieldGroup label="支払者">
              <Tabs
                label="支払者"
                value={form.payer}
                onChange={(next) => setForm({ ...form, payer: next, splits: null })}
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

          {/* 個人カテゴリの負担は本人1行＝全額に決まるので出さない（§3.6） */}
          {!isPersonal && splits.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--c-muted)]">負担</span>
                <Button
                  variant="ghost"
                  className="text-xs"
                  onClick={() => setForm({ ...form, splits: null })}
                >
                  既定に戻す
                </Button>
              </div>
              {splits.map((split) => (
                <div key={split.userId} className="flex items-center justify-between gap-2">
                  <span className="text-sm">{workspace.displayName(split.userId)}</span>
                  <TextInput
                    aria-label={`${workspace.displayName(split.userId)}の負担`}
                    inputMode="numeric"
                    className="w-28 text-right"
                    value={String(split.amount)}
                    onChange={(e) => {
                      const value = Number(e.target.value.replace(/[^\d-]/g, '')) || 0;
                      setForm({
                        ...form,
                        splits: splits.map((s) =>
                          s.userId === split.userId ? { ...s, amount: value } : s,
                        ),
                      });
                    }}
                  />
                </div>
              ))}
              <div className="flex items-center justify-between text-xs text-[var(--c-muted)]">
                <span>合計</span>
                <span data-testid="rule-splits-total">
                  {formatAmount(splits.reduce((sum, s) => sum + s.amount, 0))} /{' '}
                  {formatAmount(amount)}
                </span>
              </div>
            </div>
          )}

          <Field label="備考">
            <TextInput
              aria-label="備考"
              value={form.memo}
              onChange={(e) => setForm({ ...form, memo: e.target.value })}
            />
          </Field>

          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setForm(null)}>
              やめる
            </Button>
            <Button className="flex-1" disabled={busy} onClick={() => void save()}>
              保存
            </Button>
          </div>
        </Card>
      )}

      {pendingRemove !== null && (
        <ConfirmDialog
          title="この定期登録を削除しますか"
          detail={[
            `${workspace.categoryPath(pendingRemove.category_id)} ${formatAmount(
              pendingRemove.amount,
            )}（毎月${pendingRemove.day_of_month}日）`,
            'これ以降は登録されません。すでに作られた取引は残ります',
          ]}
          confirmLabel="削除する"
          onConfirm={() => void remove(pendingRemove)}
          onCancel={() => setPendingRemove(null)}
        />
      )}

      <Note>
        期日の来たルールはアプリを開いたときに取引になります。作られた取引は普通の取引として
        直せます。消しても同じ月にもう一度は作られません
      </Note>
    </main>
  );
}
