/**
 * ログイン状態と、画面をまたいで使うデータ（利用者・グループ・カテゴリ）。
 *
 * 量が少なく、どの画面でも要るものだけをここで持つ。取引と予算は画面ごとに読む。
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import {
  loadWorkspace,
  runRecurringRules,
  type RecurringRunResult,
  type Workspace,
} from '../../lib/db';
import { scopeKey } from '../categories/name';
import { categoryPath, type TreeCategory } from '../categories/tree';
import { toTreeCategory } from './model';
import type { MemberLike } from '../groups/members';

type AuthState = {
  session: Session | null;
  loading: boolean;
  userId: string | null;
};

const AuthContext = createContext<AuthState>({ session: null, loading: true, userId: null });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  const value = useMemo(
    () => ({ session, loading, userId: session?.user.id ?? null }),
    [session, loading],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

export type WorkspaceState = Workspace & {
  reload: () => Promise<void>;
  /** グループごとのメンバー */
  membersOf: (shareGroupId: string) => MemberLike[];
  /** 自分が属するグループの id */
  myGroupIds: string[];
  displayName: (userId: string | null) => string;
  groupName: (shareGroupId: string) => string;
  /** 共有範囲の見出し。グループ名、または「個人」 */
  scopeLabel: (item: { share_group_id: string | null }) => string;
  /** カテゴリの階層を扱う形（tree.ts）。画面ごとに作り直さない */
  tree: TreeCategory[];
  /** 表示名。小分類は『大分類 / 小分類』（§3.4.1） */
  categoryPath: (id: string) => string;
  /** 起動時、または手で実行した定期登録の結果（§5.8）。まだ実行していなければ null */
  recurringResult: RecurringRunResult | null;
  /** 定期登録を今すぐ実行する（設定画面の手動実行） */
  runRecurring: () => Promise<RecurringRunResult>;
};

const WorkspaceContext = createContext<WorkspaceState | null>(null);

const empty: Workspace = { profiles: [], groups: [], members: [], categories: [] };

export function WorkspaceProvider({ children, userId }: { children: ReactNode; userId: string }) {
  const [data, setData] = useState<Workspace>(empty);
  const [ready, setReady] = useState(false);
  const [recurringResult, setRecurringResult] = useState<RecurringRunResult | null>(null);

  const reload = useCallback(async () => {
    setData(await loadWorkspace());
    setReady(true);
  }, []);

  const runRecurring = useCallback(async () => {
    const result = await runRecurringRules();
    setRecurringResult(result);
    return result;
  }, []);

  /**
   * 起動時の実行は1回だけ。2回目は必ず「作るものなし」を返すので、
   * そのまま上書きすると1回目に登録した件数の知らせが消える（StrictMode の再実行を含む）。
   */
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      // 期日の来た定期登録を先に取引にしてから画面を出す（§5.8）。
      // 後回しにすると、生成した当月ぶんが最初のホーム画面に出ない
      try {
        await runRecurring();
      } catch {
        // 生成に失敗しても家計簿は開けるようにする。失敗の中身は RPC 側で数える
      }
      await reload();
    })();
  }, [reload, runRecurring]);

  const value = useMemo<WorkspaceState>(() => {
    const membersOf = (shareGroupId: string): MemberLike[] =>
      data.members
        .filter((m) => m.share_group_id === shareGroupId)
        .map((m) => ({
          userId: m.user_id,
          defaultWeight: m.default_weight,
          sortOrder: m.sort_order,
        }));

    const tree = data.categories.map(toTreeCategory);
    const byId = new Map(tree.map((c) => [c.id, c]));

    return {
      ...data,
      reload,
      membersOf,
      tree,
      categoryPath: (id) => {
        const found = byId.get(id);
        return found === undefined ? '' : categoryPath(tree, found);
      },
      recurringResult,
      runRecurring,
      myGroupIds: data.members.filter((m) => m.user_id === userId).map((m) => m.share_group_id),
      displayName: (id) =>
        id === null ? '共用' : (data.profiles.find((p) => p.id === id)?.display_name ?? '不明'),
      groupName: (id) => data.groups.find((g) => g.id === id)?.name ?? '不明',
      scopeLabel: (item) =>
        item.share_group_id === null
          ? '個人'
          : (data.groups.find((g) => g.id === item.share_group_id)?.name ?? '不明'),
    };
  }, [data, reload, recurringResult, runRecurring, userId]);

  if (!ready) return <p className="p-6 text-sm text-[var(--c-muted)]">読み込んでいます…</p>;
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceState {
  const value = useContext(WorkspaceContext);
  if (value === null) throw new Error('WorkspaceProvider の外です');
  return value;
}

/** 共有範囲でカテゴリをまとめる。画面では常に共有範囲つきで見せる（§2.4）。 */
export function groupByScope<T extends { share_group_id: string | null; owner_id: string | null }>(
  items: T[],
): { key: string; shareGroupId: string | null; ownerId: string | null; items: T[] }[] {
  const map = new Map<string, { key: string; shareGroupId: string | null; ownerId: string | null; items: T[] }>();
  for (const item of items) {
    const key = scopeKey(item.share_group_id, item.owner_id);
    const found = map.get(key) ?? {
      key,
      shareGroupId: item.share_group_id,
      ownerId: item.owner_id,
      items: [],
    };
    found.items.push(item);
    map.set(key, found);
  }
  return [...map.values()];
}
