import { defineConfig, devices } from '@playwright/test';

/**
 * E2E は開発サーバーとローカル Supabase に対して走らせる。
 * 事前に `npm run db:start` でローカル Supabase を立ち上げておくこと。
 *
 * テスト用の利用者を作る globalSetup は、最初の E2E を書くときに足す。
 * いまは e2e/ が空なので置いていない。
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
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
