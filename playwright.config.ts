import { defineConfig, devices } from '@playwright/test';

/**
 * E2E は開発サーバーとローカル Supabase に対して走らせる。
 * 事前に `npm run db:start` でローカル Supabase を立ち上げておくこと。
 *
 * globalSetup でテスト用の利用者を作り、各テストの前にデータを空へ戻す（e2e/fixtures.ts）。
 * pgTAP と同じ DB を使うので、pgTAP 側の利用者やグループ名は pg- で始めて分けてある。
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    locale: 'ja-JP',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
