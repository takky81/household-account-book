/**
 * 想定しない例外を受け止める。
 *
 * 受け止めないと React は画面ごと外してしまい、利用者には白い画面しか残らない。
 * ここで何が起きたかを見せ、開き直す手立てを出す（決定表「表示設定と共通の振る舞い」列6 と
 * 同じ考え方で、行き止まりを作らない）。
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, Card, Note } from './ui';

type Props = { children: ReactNode };
type State = { message: string | null };

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    return { message: error instanceof Error ? error.message : '原因の分からない不具合です' };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // 配信先にログの置き場が無いので、せめてコンソールには残す
    console.error('画面で例外が起きました', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.message === null) return this.props.children;

    return (
      <main className="mx-auto flex max-w-md flex-col gap-3 p-6">
        <h1 className="text-lg font-bold">画面を出せませんでした</h1>
        <Card>
          <p role="alert" className="text-sm">
            {this.state.message}
          </p>
        </Card>
        <Button onClick={() => window.location.reload()}>開き直す</Button>
        <Note>直らないときは、保存できていない入力を控えてからログインし直してください</Note>
      </main>
    );
  }
}
