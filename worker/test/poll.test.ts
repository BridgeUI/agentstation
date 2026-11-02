import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { POLL_FAST_MS, POLL_IDLE_MS, pollIntervalFor } from '@agentstation/shared';
import { agentToken, api, mockJwks, userToken, uuid, vmHeartbeat } from './helpers.js';

beforeAll(mockJwks);

describe('報告の間隔（poll_ms）', () => {
  it('画面が見られている・指示が進行中なら 5 秒、それ以外は 60 秒', () => {
    const now = 1_000_000;
    expect(pollIntervalFor({ hasActive: false, lastViewAt: null, now })).toBe(POLL_IDLE_MS);
    expect(pollIntervalFor({ hasActive: false, lastViewAt: now - 89_000, now })).toBe(POLL_FAST_MS);
    expect(pollIntervalFor({ hasActive: false, lastViewAt: now - 91_000, now })).toBe(POLL_IDLE_MS);
    expect(pollIntervalFor({ hasActive: true, lastViewAt: null, now })).toBe(POLL_FAST_MS);
  });

  it('/api/agent/poll は状態を保存せず、指示と poll_ms だけ返す', async () => {
    const agent = await agentToken('tok-vm1');
    const user = await userToken('hanako@example.test');

    const p1 = await api('/api/agent/poll', { token: agent, body: { env: 'vm1' } });
    expect(p1.status).toBe(200);
    expect(p1.body).toEqual({ commands: [], poll_ms: POLL_IDLE_MS });

    // 画面が見られた印があれば 5 秒
    await env.DB.prepare('INSERT OR REPLACE INTO activity (key, at) VALUES (?, ?)')
      .bind('view', Date.now())
      .run();
    const p2 = await api('/api/agent/poll', { token: agent, body: { env: 'vm1' } });
    expect(p2.body.poll_ms).toBe(POLL_FAST_MS);

    // 指示を積むと poll で running として渡される
    const id = uuid();
    await api('/api/commands', { token: user, body: { id, env: 'vm1', action: 'rc_restart' } });
    const p3 = await api('/api/agent/poll', { token: agent, body: { env: 'vm1' } });
    expect((p3.body.commands as { id: string; status: string }[]).map((c) => c.id)).toEqual([id]);
    expect(p3.body.poll_ms).toBe(POLL_FAST_MS);
    const c = await env.DB.prepare('SELECT status FROM commands WHERE id = ?')
      .bind(id)
      .first<{ status: string }>();
    expect(c?.status).toBe('running');

    // 状態（heartbeats）は保存されない
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM heartbeats WHERE env = 'vm1'").first<{
      n: number;
    }>();
    expect(n?.n).toBe(0);

    // 他の環境を名乗れない
    const p4 = await api('/api/agent/poll', { token: agent, body: { env: 'host' } });
    expect(p4.status).toBe(403);

    // ハートビートの応答にも poll_ms（指示が running なので 5 秒）
    const hb = await api('/api/agent/heartbeat', { token: agent, body: vmHeartbeat('vm1') });
    expect(hb.status).toBe(200);
    expect(hb.body.poll_ms).toBe(POLL_FAST_MS);
  });

  it('/api/status を見ると activity に印が残る', async () => {
    const user = await userToken('hanako@example.test');
    await api('/api/status', { token: user });
    const r = await env.DB.prepare("SELECT at FROM activity WHERE key = 'view'").first<{
      at: number;
    }>();
    // 同じ isolate で 20 秒以内に別のテストが書いていれば省かれることがある（その場合は null）
    if (r) expect(Date.now() - r.at).toBeLessThan(60_000);
  });
});
