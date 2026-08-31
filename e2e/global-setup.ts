import { ensureUsers, resetData } from './db';

/** E2E 用の利用者を用意し、前回の残りを消してから始める。 */
export default async function globalSetup() {
  await ensureUsers();
  await resetData();
}
