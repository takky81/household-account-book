import { describe, it, expect } from 'vitest';
import { createSubmitGuard } from './submitGuard';

describe('createSubmitGuard（決定表「表示設定と共通の振る舞い」列12）', () => {
  it('処理中の間は同じ操作を受け付けない', async () => {
    const guard = createSubmitGuard();
    let calls = 0;
    let release = () => {};
    const slow = async () => {
      calls += 1;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    };

    const first = guard.run(slow);
    const second = guard.run(slow);
    expect(calls).toBe(1);
    expect(guard.busy()).toBe(true);

    release();
    await Promise.all([first, second]);
    expect(calls).toBe(1);
    expect(guard.busy()).toBe(false);
  });

  it('終わったあとは次の操作を受け付ける', async () => {
    const guard = createSubmitGuard();
    let calls = 0;
    await guard.run(async () => {
      calls += 1;
    });
    await guard.run(async () => {
      calls += 1;
    });
    expect(calls).toBe(2);
  });

  it('失敗しても処理中のままにしない', async () => {
    const guard = createSubmitGuard();
    await expect(
      guard.run(async () => {
        throw new Error('失敗');
      }),
    ).rejects.toThrow('失敗');
    expect(guard.busy()).toBe(false);
  });
});
