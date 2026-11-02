import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Command, Heartbeat } from '@macmini/shared';
import { runCron } from '../src/cron/index.js';
import { insertCommand, saveHeartbeat } from '../src/db.js';
import type { Bindings } from '../src/env.js';
import { hostHeartbeat, uuid, vmHeartbeat } from './helpers.js';

const WEBHOOK = 'https://hooks.slack.test/services/T0/B0/x';
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const T0 = Date.UTC(2026, 9, 31, 3, 0, 0); // 2026-10-31 12:00 JST

/** Slack に POST された本文（text）を溜める */
let posted: string[] = [];
let slackStatus = 200;
const realFetch = globalThis.fetch;

beforeEach(() => {
  posted = [];
  slackStatus = 200;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === WEBHOOK) {
      const body = JSON.parse(String(init?.body)) as { text: string };
      posted.push(body.text);
      return new Response('ok', { status: slackStatus });
    }
    return new Response('テストから外部へは出られない', { status: 502 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const withSlack = (): Bindings => ({ ...env, SLACK_WEBHOOK_URL: WEBHOOK });

const hb = (x: Record<string, unknown>) => x as unknown as Heartbeat;

/** VM を両方 running と報告する host（helpers の既定は vm2 が stopped なので、停止の通知が混ざらないように） */
const vmsRunning = () =>
  (['vm1', 'vm2'] as const).map((e) => ({
    env: e,
    vm_state: 'running',
    usage: {},
    alloc: { cpu: 4, mem_gb: 6, disk_gb: 90 },
  }));
async function hostAt(receivedAt: number, extra: Record<string, unknown> = {}) {
  await saveHeartbeat(
    env.DB,
    'host',
    hb(hostHeartbeat({ vms: vmsRunning(), ...extra })),
    receivedAt,
  );
}
async function vmAt(vm: 'vm1' | 'vm2', receivedAt: number, extra: Record<string, unknown> = {}) {
  await saveHeartbeat(env.DB, vm, hb(vmHeartbeat(vm, extra)), receivedAt);
}

async function notifyKeys(): Promise<Record<string, string | null>> {
  const { results } = await env.DB.prepare('SELECT key, state FROM notify_state').all<{
    key: string;
    state: string | null;
  }>();
  return Object.fromEntries(results.map((r) => [r.key, r.state]));
}

function command(over: Partial<Command>): Command {
  return {
    id: uuid(),
    env: 'vm1',
    executor: 'vm1',
    action: 'rc_restart',
    args: null,
    status: 'queued',
    requested_by: 'hanako@example.test',
    created_at: T0 - 5 * MIN,
    not_before: null,
    expires_at: T0 + 5 * MIN,
    started_at: null,
    finished_at: null,
    output: null,
    ...over,
  };
}

describe('途絶の判定', () => {
  it('host が10分以上途絶えたら1回だけ通知し、戻ったら停止時間つきで復旧通知', async () => {
    await hostAt(T0 - 11 * MIN);
    await vmAt('vm1', T0 - 11 * MIN);

    await runCron(withSlack(), T0);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain('Mac mini 応答なし');
    expect(posted[0]).toContain('https://workstation.example.com/');
    expect(await notifyKeys()).toEqual({ 'outage:host': 'alerting' });

    // 同じ障害は繰り返さない。host が止まっている間は VM の判定もしない
    await runCron(withSlack(), T0 + MIN);
    await runCron(withSlack(), T0 + 2 * MIN);
    expect(posted).toHaveLength(1);

    // 復旧
    await hostAt(T0 + 20 * MIN);
    await vmAt('vm1', T0 + 20 * MIN);
    await runCron(withSlack(), T0 + 20 * MIN);
    expect(posted).toHaveLength(2);
    expect(posted[1]).toContain('復旧');
    expect(posted[1]).toContain('停止 31分');
    expect(await notifyKeys()).toEqual({});
  });

  it('VM のエージェントだけ途絶えたら、その VM だけ通知する', async () => {
    await hostAt(T0 - MIN);
    await vmAt('vm1', T0 - 12 * MIN);
    await vmAt('vm2', T0 - MIN);

    await runCron(withSlack(), T0);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain('vm1 のエージェントが応答なし');
    expect(posted[0]).not.toContain('Mac mini 応答なし');
    expect(posted[0]).toContain('https://workstation.example.com/vm1.html');

    await vmAt('vm1', T0 + 3 * MIN);
    await runCron(withSlack(), T0 + 3 * MIN);
    expect(posted).toHaveLength(2);
    expect(posted[1]).toContain('vm1 のエージェントが応答');
    expect(posted[1]).toContain('復旧');
  });

  it('3〜10分の遅れでは通知しない', async () => {
    await hostAt(T0 - 5 * MIN);
    await runCron(withSlack(), T0);
    expect(posted).toEqual([]);
  });
});

describe('VM の停止', () => {
  const hostWithVm2Stopped = () => hostHeartbeat(); // helpers の host 報告は vm2 が stopped

  it('5分続いたら通知し、起動したら復旧通知', async () => {
    await saveHeartbeat(env.DB, 'host', hb(hostWithVm2Stopped()), T0);
    await runCron(withSlack(), T0);
    expect(posted).toEqual([]);
    expect((await notifyKeys())['vm_stopped:vm2']).toBe('observing');

    await saveHeartbeat(env.DB, 'host', hb(hostWithVm2Stopped()), T0 + 4 * MIN);
    await runCron(withSlack(), T0 + 4 * MIN);
    expect(posted).toEqual([]);

    await saveHeartbeat(env.DB, 'host', hb(hostWithVm2Stopped()), T0 + 5 * MIN);
    await runCron(withSlack(), T0 + 5 * MIN);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain('vm2 が停止');
    await runCron(withSlack(), T0 + 6 * MIN);
    expect(posted).toHaveLength(1);

    const running = hostHeartbeat({
      vms: [{ env: 'vm2', vm_state: 'running', usage: {}, alloc: {} }],
    });
    await saveHeartbeat(env.DB, 'host', hb(running), T0 + 9 * MIN);
    await runCron(withSlack(), T0 + 9 * MIN);
    expect(posted).toHaveLength(2);
    expect(posted[1]).toContain('vm2 が起動');
    expect(await notifyKeys()).toEqual({});
  });

  it('vm_stop の指示で止めたときは通知しない', async () => {
    await insertCommand(
      env.DB,
      command({
        env: 'vm2',
        executor: 'host',
        action: 'vm_stop',
        status: 'done',
        requested_by: 'jiro@example.test',
        started_at: T0 - 30 * MIN,
        finished_at: T0 - 29 * MIN,
      }),
    );
    await saveHeartbeat(env.DB, 'host', hb(hostWithVm2Stopped()), T0 - 10 * MIN);
    await runCron(withSlack(), T0 - 10 * MIN);
    await saveHeartbeat(env.DB, 'host', hb(hostWithVm2Stopped()), T0);
    await runCron(withSlack(), T0);
    expect(posted).toEqual([]);
    expect(await notifyKeys()).toEqual({});
  });
});

describe('Remote Control', () => {
  it('要ログインは即時に通知し、戻ったら復旧通知', async () => {
    await hostAt(T0);
    await vmAt('vm1', T0, { claude: { state: 'running', rc_state: 'login_required' } });
    await runCron(withSlack(), T0);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain('vm1 は再ログインが必要');
    await runCron(withSlack(), T0 + MIN);
    expect(posted).toHaveLength(1);

    await vmAt('vm1', T0 + 8 * MIN);
    await runCron(withSlack(), T0 + 8 * MIN);
    expect(posted).toHaveLength(2);
    expect(posted[1]).toContain('vm1 の再ログインが完了');
  });

  it('再接続待ちは15分続いてから通知', async () => {
    const reconnecting = { claude: { state: 'running', rc_state: 'reconnecting' } };
    await hostAt(T0, reconnecting);
    await runCron(withSlack(), T0);
    await hostAt(T0 + 14 * MIN, reconnecting);
    await runCron(withSlack(), T0 + 14 * MIN);
    expect(posted).toEqual([]);
    await hostAt(T0 + 15 * MIN, reconnecting);
    await runCron(withSlack(), T0 + 15 * MIN);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain('Mac mini（host） の Remote Control がつながらない');
  });
});

describe('資源', () => {
  it('ディスク 85% で注意、90% で異常（状態が変わったら再通知）、下がれば復旧', async () => {
    const host = (used: number) =>
      hostHeartbeat({
        vms: vmsRunning(),
        host: { disk_total_gb: 100, disk_used_gb: used, mem_total_gb: 24, mem_used_gb: 10 },
      });
    await saveHeartbeat(env.DB, 'host', hb(host(86)), T0);
    await runCron(withSlack(), T0);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain('ディスクが残り少ない（86% 使用・注意）');

    await saveHeartbeat(env.DB, 'host', hb(host(87)), T0 + MIN);
    await runCron(withSlack(), T0 + MIN);
    expect(posted).toHaveLength(1);

    await saveHeartbeat(env.DB, 'host', hb(host(92)), T0 + 2 * MIN);
    await runCron(withSlack(), T0 + 2 * MIN);
    expect(posted).toHaveLength(2);
    expect(posted[1]).toContain('92% 使用・異常');
    expect((await notifyKeys())['disk:host']).toBe('error');

    await saveHeartbeat(env.DB, 'host', hb(host(50)), T0 + 3 * MIN);
    await runCron(withSlack(), T0 + 3 * MIN);
    expect(posted).toHaveLength(3);
    expect(posted[2]).toContain('ディスクの残量が回復');
  });

  it('メモリ 90% は10分続いてから通知', async () => {
    const host = hostHeartbeat({
      vms: vmsRunning(),
      host: { mem_total_gb: 24, mem_used_gb: 23, disk_total_gb: 512, disk_used_gb: 100 },
    });
    await saveHeartbeat(env.DB, 'host', hb(host), T0);
    await runCron(withSlack(), T0);
    expect(posted).toEqual([]);
    await saveHeartbeat(env.DB, 'host', hb(host), T0 + 10 * MIN);
    await runCron(withSlack(), T0 + 10 * MIN);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain('メモリ逼迫');
  });
});

describe('指示の期限切れ・失敗', () => {
  it('expired / failed を1回だけ通知し、依頼者は @ より前だけ', async () => {
    const a = command({ expires_at: T0 - MIN });
    const b = command({
      env: 'vm2',
      executor: 'vm2',
      requested_by: 'jiro@example.test',
      status: 'running',
      started_at: T0 - 31 * MIN,
      expires_at: T0 + 60 * MIN,
    });
    await insertCommand(env.DB, a);
    await insertCommand(env.DB, b);
    // insertCommand は started_at を書かないので、running の開始時刻を直接入れる
    await env.DB.prepare('UPDATE commands SET started_at = ? WHERE id = ?')
      .bind(b.started_at, b.id)
      .run();
    await hostAt(T0);

    await runCron(withSlack(), T0);
    expect(posted).toHaveLength(2);
    const text = posted.join('\n');
    expect(text).toContain('操作が期限切れ: vm1 のRemote Control の再起動');
    expect(text).toContain('操作が失敗: vm2 のRemote Control の再起動');
    expect(text).toContain('依頼: hanako');
    expect(text).toContain('依頼: jiro');
    expect(text).not.toContain('@');
    expect(text).not.toContain('example.test');
    expect(await notifyKeys()).toMatchObject({
      [`command:${a.id}`]: 'expired',
      [`command:${b.id}`]: 'failed',
    });

    await runCron(withSlack(), T0 + MIN);
    expect(posted).toHaveLength(2);
  });

  it('夜間メンテナンスの失敗は last_run_at ごとに1回', async () => {
    const failed = { maintenance: { last_run_at: T0 - 8 * 60 * MIN, last_result: 'failed' } };
    await hostAt(T0);
    await vmAt('vm1', T0, failed);
    await runCron(withSlack(), T0);
    await vmAt('vm1', T0 + MIN, failed);
    await runCron(withSlack(), T0 + MIN);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain('vm1 の夜間メンテナンスが失敗');

    // 翌日、別の実行が失敗したら改めて通知する（host の報告も更新しておく）
    await hostAt(T0 + DAY);
    await vmAt('vm1', T0 + DAY, {
      maintenance: { last_run_at: T0 + DAY - 8 * 60 * MIN, last_result: 'failed' },
    });
    await runCron(withSlack(), T0 + DAY);
    expect(posted).toHaveLength(2);
    expect(posted[1]).toContain('vm1 の夜間メンテナンスが失敗');
  });
});

describe('Slack', () => {
  it('Webhook 未設定なら送らずに落ちない。state も更新しないので設定後に送られる', async () => {
    await hostAt(T0 - 11 * MIN);
    const noSlack: Bindings = { ...env };
    delete noSlack.SLACK_WEBHOOK_URL;
    await runCron(noSlack, T0);
    expect(posted).toEqual([]);
    expect(await notifyKeys()).toEqual({});
    await runCron(withSlack(), T0 + MIN);
    expect(posted).toHaveLength(1);
  });

  it('送信に失敗したら state を更新せず、次回に再送する', async () => {
    await hostAt(T0 - 11 * MIN);
    slackStatus = 500;
    await runCron(withSlack(), T0);
    expect(posted).toHaveLength(1);
    expect(await notifyKeys()).toEqual({});
    slackStatus = 200;
    await runCron(withSlack(), T0 + MIN);
    expect(posted).toHaveLength(2);
    expect(await notifyKeys()).toEqual({ 'outage:host': 'alerting' });
  });

  it('本文にパス・メール・セッションのタイトルが入らない', async () => {
    await hostAt(T0 - 11 * MIN);
    await vmAt('vm1', T0 - 11 * MIN, {
      sessions: [{ id: 's1', title: '/Users/hanako/secret.txt を直す' }],
    });
    await insertCommand(
      env.DB,
      command({ expires_at: T0 - MIN, output: '/Users/hanako/.claude のログ' }),
    );
    await runCron(withSlack(), T0);
    expect(posted.length).toBeGreaterThan(0);
    const text = posted.join('\n');
    expect(text).not.toMatch(/\/Users\//);
    expect(text).not.toMatch(/@/);
    expect(text).not.toContain('secret');
    expect(text).toContain('JST');
  });
});

describe('保持期間', () => {
  it('履歴7日・指示90日・監査1年・セッション7日を過ぎた行を消す', async () => {
    const db = env.DB;
    await db.batch([
      db
        .prepare('INSERT INTO heartbeat_history (env, received_at, payload) VALUES (?, ?, ?)')
        .bind('host', T0 - 8 * DAY, '{}'),
      db
        .prepare('INSERT INTO heartbeat_history (env, received_at, payload) VALUES (?, ?, ?)')
        .bind('host', T0 - 6 * DAY, '{}'),
      db
        .prepare('INSERT INTO audit_log (at, actor_email, action) VALUES (?, ?, ?)')
        .bind(T0 - 366 * DAY, 'x@example.test', 'old'),
      db
        .prepare('INSERT INTO audit_log (at, actor_email, action) VALUES (?, ?, ?)')
        .bind(T0 - 364 * DAY, 'x@example.test', 'new'),
      db
        .prepare('INSERT INTO sessions (env, session_id, last_seen) VALUES (?, ?, ?)')
        .bind('vm1', 'old', T0 - 8 * DAY),
      db
        .prepare('INSERT INTO sessions (env, session_id, last_seen) VALUES (?, ?, ?)')
        .bind('vm1', 'new', T0 - 6 * DAY),
    ]);
    const old = command({ status: 'done', finished_at: T0 - 91 * DAY, created_at: T0 - 91 * DAY });
    const recent = command({
      status: 'done',
      finished_at: T0 - 89 * DAY,
      created_at: T0 - 89 * DAY,
    });
    await insertCommand(db, old);
    await insertCommand(db, recent);
    await db
      .prepare("UPDATE commands SET status = 'done', finished_at = ? WHERE id = ?")
      .bind(old.finished_at, old.id)
      .run();
    await db
      .prepare("UPDATE commands SET status = 'done', finished_at = ? WHERE id = ?")
      .bind(recent.finished_at, recent.id)
      .run();
    await db
      .prepare('INSERT INTO notify_state (key, state, updated_at) VALUES (?, ?, ?)')
      .bind(`command:${old.id}`, 'failed', T0 - 91 * DAY)
      .run();

    await runCron(withSlack(), T0);

    const count = async (sql: string) => (await db.prepare(sql).first<{ n: number }>())?.n ?? -1;
    expect(await count('SELECT COUNT(*) AS n FROM heartbeat_history')).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM audit_log')).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM sessions')).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM commands')).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM notify_state')).toBe(0);
    expect(posted).toEqual([]);
  });
});
