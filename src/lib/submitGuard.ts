/**
 * 二重送信を防ぐ。決定表「表示設定と共通の振る舞い」列12 に対応する。
 * 応答が遅いときに同じ操作を続けて押しても、後の押下は捨てる。
 */
export function createSubmitGuard() {
  let running = false;

  return {
    busy: () => running,
    /** 処理中なら何もしない。終わったら次を受け付ける。 */
    async run(action: () => Promise<void>): Promise<void> {
      if (running) return;
      running = true;
      try {
        await action();
      } finally {
        running = false;
      }
    },
  };
}
