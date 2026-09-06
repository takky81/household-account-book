/**
 * 画面の割り当て（docs/仕様書.md §6）。
 * ログインしていなければログイン画面だけを見せる（決定表「認証」列5・列6）。
 */

import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth, WorkspaceProvider } from './features/app/context';
import { Layout } from './features/app/Layout';
import { LoginPage } from './features/auth/LoginPage';
import { HomePage } from './features/home/HomePage';
import { TransactionFormPage } from './features/transactions/TransactionFormPage';
import { TransactionsPage } from './features/transactions/TransactionsPage';
import { AggregatePage } from './features/aggregate/AggregatePage';
import { BudgetPage } from './features/budgets/BudgetPage';
import { CategoriesPage } from './features/categories/CategoriesPage';
import { GroupsPage } from './features/groups/GroupsPage';
import { RecurringPage } from './features/recurring/RecurringPage';
import { ImportPage } from './features/transfer/ImportPage';
import { ExportPage } from './features/transfer/ExportPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { applyTheme, loadTheme, resolveTheme } from './lib/theme';
import { configError } from './lib/supabase';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Card, Note } from './components/ui';

function Routed() {
  const { session, loading, userId } = useAuth();

  if (loading) return <p className="p-6 text-sm text-[var(--c-muted)]">読み込んでいます…</p>;

  if (session === null || userId === null) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <WorkspaceProvider userId={userId}>
      <Routes>
        {/* ログイン済みならログイン画面はホームへ送る（列6） */}
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route element={<Layout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/new" element={<TransactionFormPage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/transactions/:id/edit" element={<TransactionFormPage />} />
          <Route path="/aggregate" element={<AggregatePage />} />
          <Route path="/budget" element={<BudgetPage />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="/groups" element={<GroupsPage />} />
          <Route path="/recurring" element={<RecurringPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/export" element={<ExportPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </WorkspaceProvider>
  );
}

export function App() {
  useEffect(() => {
    // 選んだことがなければ OS の設定に従う（表示設定 列2）
    applyTheme(resolveTheme(loadTheme(), window.matchMedia('(prefers-color-scheme: dark)').matches));
  }, []);

  // 接続先が無ければ何も動かない。黙って白い画面を出さず、足りないものを名指しする
  if (configError !== null) {
    return (
      <main className="mx-auto flex max-w-md flex-col gap-3 p-6">
        <h1 className="text-lg font-bold">設定が足りません</h1>
        <Card>
          <p role="alert" className="text-sm">
            {configError}
          </p>
        </Card>
        <Note>README の「本番へ出す」を見てください</Note>
      </main>
    );
  }

  return (
    <ErrorBoundary>
      <AuthProvider>
        <Routed />
      </AuthProvider>
    </ErrorBoundary>
  );
}
