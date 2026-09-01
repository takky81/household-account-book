import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

function Boom(): React.ReactElement {
  throw new Error('壊れた');
}

afterEach(() => vi.restoreAllMocks());

describe('ErrorBoundary', () => {
  it('中で例外が起きても白い画面にせず、やり直す手立てを出す', () => {
    // React が投げる例外はコンソールにも出る。テストの出力を汚さないよう黙らせる
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('壊れた');
    expect(screen.getByRole('button', { name: '開き直す' })).toBeInTheDocument();
  });

  it('例外が起きなければ中身をそのまま出す', () => {
    render(
      <ErrorBoundary>
        <p>ふつうの画面</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('ふつうの画面')).toBeInTheDocument();
  });
});
