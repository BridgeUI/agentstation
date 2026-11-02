import { env } from 'cloudflare:test';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Command, Heartbeat } from '@macmini/shared';
import { handleApi } from '../src/api/router.js';
import { runCron } from '../src/cron/index.js';
import { PLUG_ON_DEADLINE_MS } from '../src/cron/plug.js';
import { getCommand, getPlugStatus, insertCommand, saveHeartbeat } from '../src/db.js';
import type { Bindings } from '../src/env.js';
import { SWITCHBOT_API, readPlug, signedHeaders } from '../src/switchbot.js';
import { api, hostHeartbeat, mockJwks, userToken, uuid } from './helpers.js';

/**
 * スマートプラグ（docs/spec.md 6.1）。SwitchBot のクラウド API は fetch を差し替えて模擬する。
 * token・secret は Worker の secret なので、テストでは env に直接足して渡す（SELF には入っていない）。
 */

const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 1, 3, 0, 0); // 2026-11-01 12:00 JST
const WEBHOOK = 'https://hooks.slack.test/services/T0/B0/x';
const CFG = {
  SWITCHBOT_TOKEN: 'test-token',
  SWITCHBOT_SECRET: 'test-secret',
  SWITCHBOT_PLUG_DEVICE_ID: 'PLUG-1',
};

interface Call {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}
let calls: Call[] = [];
let posted: string[] = [];
/** 状態取得の応答。statusCode と body を差し替えられる */
let statusReply: { statusCode: number; body?: Record<string, unknown>; http?: number } = {
  statusCode: 100,
  body: { power: 'on', weight: 42.3, voltage: 100.1, electricCurrent: 420 },
};
/** 命令の応答（command 名 → statusCode）。無ければ 100 */
let commandReply: Record<string, number> = {};
let jwksFetch: typeof fetch;

beforeAll(async () => {
  await mockJwks();
  jwksFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === WEBHOOK) {
      posted.push((JSON.parse(String(init?.body)) as { text: string }).text);
      return new Response('ok');
    }
    if (url.startsWith(SWITCHBOT_API)) {
      const path = url.slice(SWITCHBOT_API.length);
      const headers = Object.fromEntries(new Headers(init?.headers).entries());
      const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : null;
      calls.push({ method: init?.method ?? 'GET', path, headers, body });
      if (path.endsWith('/status')) {
        if (statusReply.http) return new Response('x', { status: statusReply.http });
        return Response.json({ statusCode: statusReply.statusCode, body: statusReply.body ?? {} });
      }
      if (path.endsWith('/commands')) {
        const cmd = (body as { command: string }).command;
        return Response.json({ statusCode: commandReply[cmd] ?? 100, body: {} });
      }
      return new Response('not found', { status: 404 });
    }
    return jwksFetch(input, init);
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = jwksFetch;
});

beforeEach(() => {
  calls = [];
  posted = [];
  commandReply = {};
  statusReply = {
    statusCode: 100,
    body: { power: 'on', weight: 42.3, voltage: 100.1, electricCurrent: 420 },
  };
});

const withPlug = (extra: Partial<Bindings> = {}): Bindings => ({
  ...env,
  ...CFG,
  SLACK_WEBHOOK_URL: WEBHOOK,
  ...extra,
});
const hb = (x: Record<string, unknown>) => x as unknown as Heartbeat;
/** VM を両方 running と報告する host（helpers の既定は vm2 が stopped なので、停止の通知が混ざらないように） */
const vmsRunning = () =>
  (['vm1', 'vm2'] as const).map((e) => ({
    env: e,
    vm_state: 'running',
    usage: {},
    alloc: { cpu: 4, mem_gb: 6, disk_gb: 90 },
  }));
const hostAt = (at: number) =>
  saveHeartbeat(env.DB, 'host', hb(hostHeartbeat({ vms: vmsRunning() })), at);

/** SELF ではなく、secret を足した env で API を呼ぶ */
async function apiWith(
  bindings: Bindings,
  path: string,
  init: { token: string; body?: unknown; method?: string },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = { 'Cf-Access-Jwt-Assertion': init.token };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  const req = new Request(`https://mac.example.test${path}`, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
  const res = await handleApi(req, bindings, ctx);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function powerCycle(over: Partial<Command> = {}): Command {
  return {
    id: uuid(),
    env: 'host',
    executor: 'cloud',
    action: 'host_power_cycle',
    args: null,
    status: 'queued',
    requested_by: 'taro@example.test',
    created_at: T0 - 2 * MIN,
    not_before: T0 - MIN,
    expires_at: T0 + 9 * MIN,
    started_at: null,
    finished_at: null,
    output: null,
    ...over,
  };
}

describe('SwitchBot API の署名', () => {
  it('token+t+nonce を secret で HMAC-SHA256 し base64 にした sign を付ける', async () => {
    const h = await signedHeaders('tok', 'sec', 1700000000000, 'nonce-1');
    expect(h.Authorization).toBe('tok');
    expect(h.t).toBe('1700000000000');
    expect(h.nonce).toBe('nonce-1');
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode('sec'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const mac = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode('tok1700000000000nonce-1'),
    );
    expect(h.sign).toBe(btoa(String.fromCharCode(...new Uint8Array(mac))));
  });

  it('状態の応答から電源と W を読む。オフライン（161）や HTTP エラーは ok=false で理由だけ残す', async () => {
    const cfg = { token: 'secret-token-xyz', secret: 'secret-key-xyz', deviceId: 'PLUG-1' };
    expect(await readPlug(cfg, T0)).toEqual({
      checked_at: T0,
      ok: true,
      state: 'on',
      watts: 42.3,
      error: null,
    });
    expect(calls[0]?.path).toBe('/v1.1/devices/PLUG-1/status');
    statusReply = { statusCode: 161 };
    const off = await readPlug(cfg, T0);
    expect(off.ok).toBe(false);
    expect(off.error).toContain('オフライン');
    statusReply = { statusCode: 100, http: 401 };
    expect((await readPlug(cfg, T0)).error).toContain('HTTP 401');
    // token・secret は応答にも error にも入らない
    expect(JSON.stringify(off)).not.toContain('xyz');
  });
});

describe('電源の入れ直しの受け付け', () => {
  it('未設定なら 503、host が報告しているなら 409、途絶えていれば 201（executor は cloud）', async () => {
    const owner = await userToken('taro@example.test');
    const body = { id: uuid(), env: 'host', action: 'host_power_cycle', confirm_text: 'host' };
    // SELF には SwitchBot の secret が無い
    expect((await api('/api/commands', { token: owner, body })).status).toBe(503);

    await hostAt(Date.now() - MIN);
    const alive = await apiWith(withPlug(), '/api/commands', { token: owner, body });
    expect(alive.status).toBe(409);
    expect(String(alive.body.error)).toContain('届いている');

    await hostAt(Date.now() - 11 * MIN);
    const noConfirm = await apiWith(withPlug(), '/api/commands', {
      token: owner,
      body: { ...body, confirm_text: undefined },
    });
    expect(noConfirm.status).toBe(400);
    const r = await apiWith(withPlug(), '/api/commands', { token: owner, body });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ executor: 'cloud', action: 'host_power_cycle', env: 'host' });
    expect((r.body.not_before as number) - (r.body.created_at as number)).toBe(60_000);

    // 本人（host は taro）でもオーナー以外は 403
    const other = await userToken('hanako@example.test');
    expect(
      (await apiWith(withPlug(), '/api/commands', { token: other, body: { ...body, id: uuid() } }))
        .status,
    ).toBe(403);
  });

  it('/api/status に plug_enabled と直近の状態が入る', async () => {
    const owner = await userToken('taro@example.test');
    const off = await api('/api/status', { token: owner });
    expect(off.body.plug_enabled).toBe(false);
    expect(off.body.plug).toBeNull();

    await runCron(withPlug(), T0);
    const on = await apiWith(withPlug(), '/api/status', { token: owner });
    expect(on.body.plug_enabled).toBe(true);
    expect(on.body.plug).toMatchObject({ ok: true, state: 'on', watts: 42.3 });
  });
});

describe('Cron での実行', () => {
  it('queued → オフ（running）→ 次の回でオン → done。監査ログは worker:plug', async () => {
    const c = powerCycle();
    await insertCommand(env.DB, c);
    await hostAt(T0 - 11 * MIN);

    await runCron(withPlug(), T0);
    const after1 = await getCommand(env.DB, c.id);
    expect(after1?.status).toBe('running');
    expect(after1?.output).toContain('オフ');
    const cmds = () => calls.filter((x) => x.path.endsWith('/commands'));
    expect(cmds().map((x) => (x.body as { command: string }).command)).toEqual(['turnOff']);
    expect(cmds()[0]?.headers.authorization).toBe('test-token');
    // 状態も同じ回に読んで保存している
    expect((await getPlugStatus(env.DB))?.watts).toBe(42.3);

    await runCron(withPlug(), T0 + MIN);
    const after2 = await getCommand(env.DB, c.id);
    expect(after2?.status).toBe('done');
    expect(cmds().map((x) => (x.body as { command: string }).command)).toEqual([
      'turnOff',
      'turnOn',
    ]);
    const { results } = await env.DB.prepare(
      "SELECT actor_email, action FROM audit_log WHERE detail = 'host_power_cycle' ORDER BY id",
    ).all<{ actor_email: string; action: string }>();
    expect(results).toEqual([
      { actor_email: 'worker:plug', action: 'command.running' },
      { actor_email: 'worker:plug', action: 'command.done' },
    ]);
    // 成功は Slack に流さない（復旧通知が別に来る）
    expect(posted.filter((p) => p.includes('入れ直し'))).toEqual([]);
  });

  it('オンに失敗し続けたら期限で failed にし、手でオンにする案内を Slack に出す', async () => {
    const c = powerCycle();
    await insertCommand(env.DB, c);
    await hostAt(T0 - 11 * MIN);
    await runCron(withPlug(), T0); // オフ
    commandReply = { turnOn: 190 };
    await runCron(withPlug(), T0 + MIN);
    const retrying = await getCommand(env.DB, c.id);
    expect(retrying?.status).toBe('running');
    expect(retrying?.output).toContain('再試行');

    await runCron(withPlug(), T0 + PLUG_ON_DEADLINE_MS + MIN);
    const failed = await getCommand(env.DB, c.id);
    expect(failed?.status).toBe('failed');
    expect(failed?.output).toContain('SwitchBot アプリで手動でオン');
    // failed の通知は次の回の「指示の結果の通知」で出る（同じ回でも段階の順で出る）
    const msg = posted.find((p) => p.includes('操作が失敗'));
    expect(msg).toContain('電源の入れ直し');
    expect(msg).toContain('手動でオン');
  });

  it('オフに失敗したら failed。Mac はそのまま', async () => {
    const c = powerCycle();
    await insertCommand(env.DB, c);
    commandReply = { turnOff: 161 };
    await runCron(withPlug(), T0);
    const r = await getCommand(env.DB, c.id);
    expect(r?.status).toBe('failed');
    expect(r?.output).toContain('オフに失敗');
    expect(calls.filter((x) => x.path.endsWith('/commands'))).toHaveLength(1);
  });

  it('未設定なら SwitchBot を呼ばず、cloud の指示も触らない', async () => {
    const c = powerCycle();
    await insertCommand(env.DB, c);
    await runCron({ ...env, SLACK_WEBHOOK_URL: WEBHOOK }, T0);
    expect(calls).toEqual([]);
    expect((await getCommand(env.DB, c.id))?.status).toBe('queued');
  });
});

describe('プラグを使った通知', () => {
  it('host 応答なしの通知に、プラグの様子（消費電力がほぼ 0）を添える', async () => {
    statusReply = { statusCode: 100, body: { power: 'on', weight: 0.4 } };
    await hostAt(T0 - 11 * MIN);
    await runCron(withPlug(), T0);
    const msg = posted.find((p) => p.includes('Mac mini 応答なし'));
    expect(msg).toContain('電源プラグ: オン・0.4W');
    expect(msg).toContain('ほぼ 0');
  });

  it('プラグに届かないときは回線かルーターの可能性と書く', async () => {
    statusReply = { statusCode: 161 };
    await hostAt(T0 - 11 * MIN);
    await runCron(withPlug(), T0);
    const msg = posted.find((p) => p.includes('Mac mini 応答なし'));
    expect(msg).toContain('届かない');
    expect(msg).toContain('ルーター');
  });

  it('プラグがオフのまま 2 分続いたら通知し、オンに戻ったら復旧通知。入れ直しの最中は通知しない', async () => {
    statusReply = { statusCode: 100, body: { power: 'off', weight: 0 } };
    await hostAt(T0);
    await runCron(withPlug(), T0);
    await runCron(withPlug(), T0 + MIN);
    expect(posted.filter((p) => p.includes('プラグがオフ'))).toEqual([]);
    await runCron(withPlug(), T0 + 2 * MIN);
    expect(posted.filter((p) => p.includes('スマートプラグがオフ'))).toHaveLength(1);
    await runCron(withPlug(), T0 + 3 * MIN);
    expect(posted.filter((p) => p.includes('スマートプラグがオフ'))).toHaveLength(1);

    statusReply = { statusCode: 100, body: { power: 'on', weight: 40 } };
    await runCron(withPlug(), T0 + 4 * MIN);
    expect(
      posted.find((p) => p.includes('復旧') && p.includes('スマートプラグがオン')),
    ).toBeTruthy();

    // 入れ直しの最中（running）はオフでも通知しない
    posted = [];
    await insertCommand(
      env.DB,
      powerCycle({ status: 'running', started_at: T0 + 5 * MIN, created_at: T0 + 4 * MIN }),
    );
    statusReply = { statusCode: 100, body: { power: 'off', weight: 0 } };
    await runCron(withPlug(), T0 + 5 * MIN);
    expect(posted.filter((p) => p.includes('スマートプラグがオフ'))).toEqual([]);
  });

  it('host は生きているのにプラグに届かない状態が 15 分続いたら通知', async () => {
    statusReply = { statusCode: 100, http: 500 };
    await hostAt(T0);
    await runCron(withPlug(), T0);
    await hostAt(T0 + 14 * MIN);
    await runCron(withPlug(), T0 + 14 * MIN);
    expect(posted).toEqual([]);
    await hostAt(T0 + 15 * MIN);
    await runCron(withPlug(), T0 + 15 * MIN);
    expect(posted.find((p) => p.includes('スマートプラグに届かない'))).toContain('HTTP 500');
  });
});
