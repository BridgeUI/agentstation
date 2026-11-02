import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeEach } from 'vitest';

// 各テストファイルの前に D1 のスキーマを作る
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// テストごとに表を空にする（ストレージはテスト間で共有されるため）
beforeEach(async () => {
  await env.DB.batch(
    [
      'heartbeats',
      'heartbeat_history',
      'commands',
      'audit_log',
      'sessions',
      'notify_state',
      'plug_status',
    ].map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
  );
});
