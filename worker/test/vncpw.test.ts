import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, mockJwks, userToken } from './helpers.js';

beforeAll(mockJwks);

/** VNC パスワード（docs/spec.md 13章 #16）。secret から本人・オーナーにだけ返し、見たことを監査ログに残す */
describe('VNC パスワード', () => {
  it('未登録なら 404、登録があれば本人に返す。他人の環境は 403、閲覧者も 403', async () => {
    const hanako = await userToken('hanako@example.test');
    const b = env as unknown as { VNC_PASSWORDS_JSON?: string };
    const saved = b.VNC_PASSWORDS_JSON;
    try {
      delete b.VNC_PASSWORDS_JSON;
      expect((await api('/api/vnc-password?env=vm1', { token: hanako })).status).toBe(404);

      b.VNC_PASSWORDS_JSON = JSON.stringify({ vm1: 'secret-vm1', vm2: 'secret-vm2' });
      const r = await api('/api/vnc-password?env=vm1', { token: hanako });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ env: 'vm1', password: 'secret-vm1' });

      // 他人の環境は見られない
      expect((await api('/api/vnc-password?env=vm2', { token: hanako })).status).toBe(403);
      // host（未登録）は 404 ではなく、まず権限で 403
      expect((await api('/api/vnc-password?env=host', { token: hanako })).status).toBe(403);
      // オーナーは全部見られる
      const owner = await userToken('taro@example.test');
      const viewer = await userToken('viewer@example.test');
      expect((await api('/api/vnc-password?env=vm1', { token: viewer })).status).toBe(403);
      expect((await api('/api/vnc-password?env=vm2', { token: owner })).status).toBe(200);
      // env が不正
      expect((await api('/api/vnc-password?env=x', { token: owner })).status).toBe(400);

      // 監査ログには「見た」ことだけ残り、値は残らない
      const audit = await api('/api/audit?limit=10', { token: owner });
      const rows = audit.body as unknown as { action: string; target: string; detail: unknown }[];
      const views = rows.filter((a) => a.action === 'vnc.password.view');
      expect(views.length).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(rows)).not.toContain('secret-vm');
    } finally {
      if (saved === undefined) delete b.VNC_PASSWORDS_JSON;
      else b.VNC_PASSWORDS_JSON = saved;
    }
  });
});
