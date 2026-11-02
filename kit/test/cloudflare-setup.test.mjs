// kit/cloudflare-setup.mjs を、メモリ上の偽の Cloudflare API で確かめる（node --test kit/test）。
// 実際の Cloudflare には繋がない。API の形は Cloudflare API v4 のドキュメントに合わせているが、
// 実機の Cloudflare アカウントでの確認は別に要る。
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { cloudflareApi, desiredState, run } from '../cloudflare-setup.mjs';

const SITE = {
  domain: 'acme.dev',
  dashboard_host: 'mini.acme.dev',
  access_team: 'acme',
  people: {
    host: { name: 'Ken', login: 'ken', email: 'ken@acme.dev' },
    vm1: { name: 'Mai', login: 'mai', email: 'mai@gmail.com' },
  },
  viewers: ['boss@acme.dev'],
};

/** 偽の API。資源を種類ごとの配列で持ち、呼ばれた書き込みを記録する */
function fakeCloudflare() {
  let n = 0;
  const id = () => `id${++n}`;
  const db = {
    accounts: [{ id: 'acc1' }],
    zones: [{ id: 'zone1', name: 'acme.dev' }],
    d1: [],
    idps: [],
    tokens: [],
    policies: [],
    apps: [],
    cas: {},
    tunnels: [],
    configs: {},
    dns: [],
    routes: [],
  };
  const writes = [];
  const ok = (result, info) =>
    new Response(
      JSON.stringify({ success: true, result, ...(info ? { result_info: info } : {}) }),
      {
        headers: { 'content-type': 'application/json' },
      },
    );
  const list = (arr) => ok(arr, { page: 1, total_pages: 1 });
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    const path = u.pathname.replace('/client/v4', '');
    const method = init.method;
    const body = init.body ? JSON.parse(init.body) : undefined;
    if (method !== 'GET') writes.push(`${method} ${path}`);
    let m;
    if (path === '/accounts') return list(db.accounts);
    if (path === '/zones')
      return list(db.zones.filter((z) => z.name === u.searchParams.get('name')));
    if ((m = path.match(/^\/zones\/(\w+)\/dns_records$/))) {
      if (method === 'GET')
        return list(db.dns.filter((r) => r.name === u.searchParams.get('name')));
      const r = { id: id(), ...body };
      db.dns.push(r);
      return ok(r);
    }
    const A = '/accounts/acc1';
    const collection = (key, extra = {}) => {
      if (method === 'GET') return list(db[key]);
      const r = { id: id(), ...body, ...extra };
      db[key].push(r);
      return ok(r);
    };
    if (path === `${A}/d1/database`)
      return collection('d1', { uuid: 'd1-uuid-0000-0000-0000-000000000000' });
    if (path === `${A}/access/identity_providers`) return collection('idps');
    if (path === `${A}/access/service_tokens`)
      return collection('tokens', {
        client_id: `cid-${body?.name}.access`,
        client_secret: 'SECRET-VALUE',
      });
    if (path === `${A}/access/policies`) return collection('policies');
    if ((m = path.match(/^\/accounts\/acc1\/access\/policies\/(\w+)$/))) {
      Object.assign(
        db.policies.find((p) => p.id === m[1]),
        body,
      );
      return ok({ id: m[1] });
    }
    if (path === `${A}/access/apps`) return collection('apps', { aud: `aud-${body?.name}` });
    if ((m = path.match(/^\/accounts\/acc1\/access\/apps\/(\w+)\/ca$/))) {
      if (method === 'GET')
        return db.cas[m[1]]
          ? ok(db.cas[m[1]])
          : new Response(JSON.stringify({ success: false, errors: [{ code: 404 }] }), {
              status: 404,
            });
      db.cas[m[1]] = { public_key: `ecdsa-sha2-nistp256 KEY-${m[1]}` };
      return ok(db.cas[m[1]]);
    }
    if ((m = path.match(/^\/accounts\/acc1\/access\/apps\/(\w+)$/))) return ok({ id: m[1] });
    if (path === `${A}/cfd_tunnel`) return collection('tunnels');
    if ((m = path.match(/^\/accounts\/acc1\/cfd_tunnel\/(\w+)\/configurations$/))) {
      db.configs[m[1]] = body.config;
      return ok({});
    }
    if ((m = path.match(/^\/accounts\/acc1\/cfd_tunnel\/(\w+)\/token$/)))
      return ok('TUNNEL-TOKEN-VALUE');
    if (path === `${A}/teamnet/routes`) return collection('routes');
    return new Response(
      JSON.stringify({ success: false, errors: [{ message: `unknown ${method} ${path}` }] }),
      {
        status: 404,
      },
    );
  };
  return { db, writes, api: cloudflareApi('test-token', fetchImpl) };
}

test('作るものは使う環境の分だけ', () => {
  const w = desiredState(SITE);
  assert.deepEqual(w.enabled, ['host', 'vm1']);
  assert.deepEqual(Object.keys(w.apps), [
    'dashboard',
    'agent',
    'ssh-host',
    'vnc-host',
    'ssh-vm1',
    'vnc-vm1',
  ]);
  assert.deepEqual(w.policies.vm1.emails, ['mai@gmail.com', 'ken@acme.dev']);
  assert.deepEqual(w.policies.members.emails, ['ken@acme.dev', 'mai@gmail.com', 'boss@acme.dev']);
  assert.equal(w.ingress.at(-1).service, 'http_status:404');
  assert.equal(
    w.ingress.find((r) => r.hostname === 'ssh-vm1.acme.dev').service,
    'ssh://192.168.64.10:22',
  );
  assert.equal(
    w.ingress.find((r) => r.hostname === 'ssh-host.acme.dev').service,
    'ssh://localhost:22',
  );
});

test('計画だけのときは何も書き込まない', async () => {
  const cf = fakeCloudflare();
  const lines = [];
  await run({
    api: cf.api,
    site: SITE,
    apply: false,
    log: (l) => lines.push(l),
    secretsDir: mkdtempSync(join(tmpdir(), 'cf-')),
  });
  assert.deepEqual(cf.writes, []);
  assert.ok(lines.some((l) => l.includes('作る予定: D1 データベース agentstation')));
});

test('作る → もう一度実行しても増えない。秘密はファイルにだけ書き、ログには出さない', async () => {
  const cf = fakeCloudflare();
  const dir = mkdtempSync(join(tmpdir(), 'cf-'));
  const lines = [];
  const log = (l) => lines.push(l);
  const r1 = await run({ api: cf.api, site: SITE, apply: true, log, secretsDir: dir });
  assert.equal(cf.db.apps.length, 6);
  assert.equal(cf.db.tokens.length, 2);
  assert.equal(cf.db.dns.length, 4);
  assert.equal(cf.db.routes.length, 1);
  assert.equal(cf.db.idps[0].type, 'onetimepin');
  assert.equal(r1.cloudflare.access_aud_dashboard, 'aud-agentstation');
  assert.equal(r1.cloudflare.access_aud_agent, 'aud-agentstation-agent-api');
  assert.equal(r1.cloudflare.d1_database_id, 'd1-uuid-0000-0000-0000-000000000000');
  assert.deepEqual(Object.keys(r1.cloudflare.agent_client_ids), ['host', 'vm1']);
  // 秘密：ファイル（600）にだけ
  const tok = join(dir, 'token.vm1.json');
  assert.equal(JSON.parse(readFileSync(tok, 'utf8')).client_secret, 'SECRET-VALUE');
  assert.equal(statSync(tok).mode & 0o777, 0o600);
  assert.equal(readFileSync(join(dir, 'tunnel-token'), 'utf8').trim(), 'TUNNEL-TOKEN-VALUE');
  assert.ok(!lines.join('\n').includes('SECRET-VALUE'));
  assert.ok(!lines.join('\n').includes('TUNNEL-TOKEN-VALUE'));
  // サービストークンのポリシーにトークンが入っている
  const svc = cf.db.policies.find((p) => p.name === 'agentstation agents');
  assert.equal(svc.include.length, 2);

  const before = {
    apps: cf.db.apps.length,
    tokens: cf.db.tokens.length,
    dns: cf.db.dns.length,
    routes: cf.db.routes.length,
    tunnels: cf.db.tunnels.length,
  };
  await run({
    api: cf.api,
    site: { ...SITE, cloudflare: r1.cloudflare },
    apply: true,
    log: () => {},
    secretsDir: dir,
  });
  assert.deepEqual(
    {
      apps: cf.db.apps.length,
      tokens: cf.db.tokens.length,
      dns: cf.db.dns.length,
      routes: cf.db.routes.length,
      tunnels: cf.db.tunnels.length,
    },
    before,
  );
});
