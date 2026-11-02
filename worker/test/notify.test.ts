import { env } from 'cloudflare:test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, mockJwks, userToken } from './helpers.js';

const WEBHOOK = 'https://hooks.slack.test/services/T0/B0/x';

/** Slack への POST を捕まえる。それ以外（Access の JWKS）は mockJwks の fetch に回す */
let posted: string[] = [];
let slackStatus = 200;
let jwksFetch: typeof fetch;

beforeAll(async () => {
  await mockJwks();
  jwksFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === WEBHOOK) {
      const body = JSON.parse(String(init?.body)) as { text: string };
      posted.push(body.text);
      return new Response('ok', { status: slackStatus });
    }
    return jwksFetch(input, init);
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = jwksFetch;
});

const bindings = env as unknown as { SLACK_WEBHOOK_URL?: string };

describe('Slack のテスト通知', () => {
  it('オーナーだけが送れる。未登録なら 503、送れたら監査ログに残る（URL は残らない）', async () => {
    const owner = await userToken('taro@example.test');
    const member = await userToken('hanako@example.test');
    const viewer = await userToken('viewer@example.test');
    const saved = bindings.SLACK_WEBHOOK_URL;
    try {
      posted = [];
      delete bindings.SLACK_WEBHOOK_URL;
      expect((await api('/api/notify/test', { method: 'POST', token: owner })).status).toBe(503);

      bindings.SLACK_WEBHOOK_URL = WEBHOOK;
      expect((await api('/api/notify/test', { method: 'POST', token: member })).status).toBe(403);
      expect((await api('/api/notify/test', { method: 'POST', token: viewer })).status).toBe(403);
      expect(posted).toEqual([]);

      const r = await api('/api/notify/test', { method: 'POST', token: owner });
      expect(r.status).toBe(200);
      expect(r.body.sent).toBe(true);
      expect(posted).toHaveLength(1);
      expect(posted[0]).toContain('テスト通知');
      expect(posted[0]).toContain('送信: taro');
      expect(posted[0]).not.toContain('@example.test');
      expect(posted[0]).toContain('https://workstation.example.com/');

      // 送信に失敗したら 502。監査ログには sent / failed だけ残り、Webhook の URL は残らない
      slackStatus = 500;
      expect((await api('/api/notify/test', { method: 'POST', token: owner })).status).toBe(502);
      slackStatus = 200;

      const audit = await api('/api/audit?limit=10', { token: owner });
      const rows = audit.body as unknown as { action: string; detail: string | null }[];
      const tests = rows.filter((a) => a.action === 'notify.test').map((a) => a.detail);
      expect(tests.sort()).toEqual(['failed', 'sent']);
      expect(JSON.stringify(rows)).not.toContain('hooks.slack');
    } finally {
      if (saved === undefined) delete bindings.SLACK_WEBHOOK_URL;
      else bindings.SLACK_WEBHOOK_URL = saved;
    }
  });
});
