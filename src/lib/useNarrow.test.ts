import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNarrow } from './useNarrow';

type Listener = () => void;

/** matchMedia を差し替えて、幅の変化を起こせるようにする。 */
function stubMatchMedia(initial: boolean) {
  let matches = initial;
  const listeners: Listener[] = [];
  vi.stubGlobal('matchMedia', (query: string) => ({
    // 変化のたびに読み直されるので getter で持つ
    get matches() {
      return matches;
    },
    media: query,
    addEventListener: (_: string, fn: Listener) => listeners.push(fn),
    removeEventListener: (_: string, fn: Listener) => {
      const at = listeners.indexOf(fn);
      if (at >= 0) listeners.splice(at, 1);
    },
  }));
  return {
    resize(next: boolean) {
      matches = next;
      for (const fn of [...listeners]) fn();
    },
    listenerCount: () => listeners.length,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('useNarrow', () => {
  it('列3 画面幅が狭いときは true を返す', () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useNarrow());
    expect(result.current).toBe(true);
  });

  it('列3 広いときは false を返す', () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => useNarrow());
    expect(result.current).toBe(false);
  });

  it('列3 幅が変わると追従する', () => {
    const media = stubMatchMedia(false);
    const { result } = renderHook(() => useNarrow());
    act(() => media.resize(true));
    expect(result.current).toBe(true);
  });

  it('外したときに購読も外す', () => {
    const media = stubMatchMedia(false);
    const { unmount } = renderHook(() => useNarrow());
    expect(media.listenerCount()).toBe(1);
    unmount();
    expect(media.listenerCount()).toBe(0);
  });
});
