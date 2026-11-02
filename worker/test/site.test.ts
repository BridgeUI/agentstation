import { createExecutionContext, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseSiteConfig } from '@agentstation/shared';
import worker from '../src/index.js';
import { renderMessage } from '../src/cron/slack.js';
import type { Bindings } from '../src/env.js';
import { mockJwks, userToken } from './helpers.js';

/** 導入先ごとの表示の値（SITE_JSON）。画面は /api/me の site で受け取る */

const OWNER = 'taro@example.test';
const SITE = JSON.stringify({
  org_name: 'Acme',
  org_footer: 'Acme Inc.',
  domain: 'acme.dev',
  dashboard_host: 'mini.acme.dev',
  access_team: 'acme',
  people: { host: { name: 'Ken', login: 'ken' }, vm2: { name: 'Sho', login: 'sho' } },
});
const ACME: Bindings = {
  ...env,
  SITE_JSON: SITE,
  MEMBERS_JSON: JSON.stringify({
    owner: OWNER,
    envs: { host: OWNER, vm2: 'sho@example.test' },
    viewers: [],
  }),
};

async function get(bindings: Bindings, path: string, token?: string): Promise<Response> {
  const req = new Request(`https://mac.example.test${path}`, {
    headers: token ? { 'Cf-Access-Jwt-Assertion': token } : {},
  });
  return worker.fetch(req, bindings, createExecutionContext());
}

beforeAll(mockJwks);

describe('SITE_JSON', () => {
  it('/api/me は使っている環境の名前とドメインを返す', async () => {
    const res = await get(ACME, '/api/me', await userToken(OWNER));
    const me = (await res.json()) as { site: { domain: string; people: Record<string, unknown> } };
    expect(me.site.domain).toBe('acme.dev');
    expect(me.site.people).toEqual({
      host: { name: 'Ken', login: 'ken' },
      vm2: { name: 'Sho', login: 'sho' },
    });
  });

  it('ホーム画面のショートカットは使っている環境だけ、名前入り', async () => {
    const res = await get(ACME, '/manifest.webmanifest');
    expect(res.status).toBe(200);
    const m = (await res.json()) as { shortcuts: { name: string; url: string }[] };
    expect(m.shortcuts.map((s) => [s.name, s.url])).toEqual([
      ['Ken の環境', '/host.html'],
      ['Sho の環境', '/vm2.html'],
    ]);
  });

  it('Slack の通知のリンクは dashboard_host', () => {
    const text = renderMessage(
      { title: 't', env: 'vm2', kind: 'alert' },
      Date.UTC(2026, 10, 1),
      'Asia/Tokyo',
      'https://mini.acme.dev/',
    );
    expect(text).toContain('https://mini.acme.dev/vm2.html');
  });

  it('形が違えば例外（黙って見本の値で動かない）', () => {
    expect(() => parseSiteConfig('{"org_name":"<b>"}')).toThrow(/SITE_JSON/);
    expect(parseSiteConfig(undefined).domain).toBe('example.com');
  });
});
