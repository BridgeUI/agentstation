import { describe, expect, it } from 'vitest';
import type { Heartbeat } from '@agentstation/shared';
import { formatLogLine } from '../src/log.js';
import { ApiClient, type FetchLike } from '../src/send/client.js';
import { buildConfig, DEFAULT_LABELS } from '../src/config.js';
import { parseState } from '../src/state.js';

const vmHb: Heartbeat = {
  env: 'vm1',
  agent_version: '0.1.0',
  agent_started_at: 1,
  sent_at: 2,
  claude: { state: 'running', rc_state: 'connected' },
  codex: { state: 'unknown' },
  sessions: [],
  guest: {},
};

function client(fetchImpl: FetchLike, logs: string[] = []) {
  return new ApiClient(
    { baseUrl: 'https://mac.example.test', clientId: 'cid', clientSecret: 'csecret' },
    {
      info() {},
      warn(m) {
        logs.push(m);
      },
      error(m) {
        logs.push(m);
      },
    },
    fetchImpl,
  );
}

describe('API クライアント', () => {
  it('ヘッダーと JSON で送り、commands と peers を返す', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const c = client(async (url, init) => {
      seen = { url, init };
      return new Response(
        JSON.stringify({ commands: [], peers: { vm1: { received_at: 1, busy: false } } }),
        {
          status: 200,
        },
      );
    });
    const res = await c.postHeartbeat(vmHb);
    expect(res).toEqual({ commands: [], peers: { vm1: { received_at: 1, busy: false } } });
    const s = seen as unknown as { url: string; init: RequestInit };
    expect(s.url).toBe('https://mac.example.test/api/agent/heartbeat');
    const h = s.init.headers as Record<string, string>;
    expect(h['CF-Access-Client-Id']).toBe('cid');
    expect(h['CF-Access-Client-Secret']).toBe('csecret');
    expect(h['content-type']).toBe('application/json');
    expect(JSON.parse(String(s.init.body))).toEqual(vmHb);
  });
  it('5xx・ネットワーク失敗は null（次回に回す）', async () => {
    const logs: string[] = [];
    expect(
      await client(async () => new Response('x', { status: 503 }), logs).postHeartbeat(vmHb),
    ).toBeNull();
    expect(
      await client(async () => {
        throw new TypeError('fetch failed');
      }, logs).postHeartbeat(vmHb),
    ).toBeNull();
    expect(logs.join('\n')).not.toMatch(/csecret/);
  });
  it('秘密情報らしき値があれば送らず、キーだけログに出す', async () => {
    let called = false;
    const logs: string[] = [];
    const c = client(async () => {
      called = true;
      return new Response('{}');
    }, logs);
    const bad: Heartbeat = { ...vmHb, guest: { os_version: '/Users/x' } };
    expect(await c.postHeartbeat(bad)).toBeNull();
    expect(called).toBe(false);
    expect(logs).toHaveLength(1);
    expect(logs[0]).not.toMatch(/\/Users/);
  });
  it('result の output に秘密情報があれば本文を落として送る', async () => {
    let body = '';
    const c = client(async (_u, init) => {
      body = String(init.body);
      return new Response('{"ok":true}');
    });
    expect(await c.postResult({ id: 'c1', status: 'done', output: 'see /Users/x/y' })).toBe(true);
    expect(JSON.parse(body)).toEqual({
      id: 'c1',
      status: 'done',
      output: '出力に秘密情報らしき文字列が含まれたため省略',
    });
  });
});

describe('設定', () => {
  const settings = { base_url: 'https://mac.example.test/', claude_path: '/opt/claude/bin/claude' };
  const token = { client_id: 'a', client_secret: 'b' };
  it('既定値と末尾スラッシュ', () => {
    const c = buildConfig({
      env: 'vm1',
      settings,
      token,
      home: '/Users/t',
      uid: 502,
      configDir: '/Users/t/.config/agentstation',
    });
    expect(c.baseUrl).toBe('https://mac.example.test');
    expect(c.tartPath).toBeNull();
    expect(c.labels.claudeRc).toBe(DEFAULT_LABELS.claude_rc);
    expect(c.labels.vm.vm2).toBe(DEFAULT_LABELS.vm2);
    expect(c.vmPlists.vm1).toBe('/Users/t/Library/LaunchAgents/co.bridgeui.agentstation.tart-vm1.plist');
    expect(c.rcDebugLog).toBe('/Users/t/Library/Logs/claude-rc.log');
    expect(c.stateFile).toBe('/Users/t/.config/agentstation/state.json');
    expect(c.intervalMs).toBe(60_000);
  });
  it('host は tart_path が必須、パスは絶対パス', () => {
    expect(() =>
      buildConfig({ env: 'host', settings, token, home: '/Users/t', uid: 501, configDir: '/c' }),
    ).toThrow(/tart_path/);
    expect(() =>
      buildConfig({
        env: 'vm1',
        settings: { ...settings, claude_path: 'claude' },
        token,
        home: '/Users/t',
        uid: 501,
        configDir: '/c',
      }),
    ).toThrow(/絶対パス/);
    expect(() =>
      buildConfig({
        env: 'vm1',
        settings,
        token: { client_id: 'a' },
        home: '/Users/t',
        uid: 501,
        configDir: '/c',
      }),
    ).toThrow(/client_secret/);
  });
  it('codex を null にすると常駐なし扱い', () => {
    const c = buildConfig({
      env: 'vm1',
      settings: { ...settings, labels: { codex: null } },
      token,
      home: '/Users/t',
      uid: 501,
      configDir: '/c',
    });
    expect(c.labels.codex).toBeNull();
  });
});

describe('状態ファイルとログ行', () => {
  it('壊れた値は捨てる', () => {
    const s = parseState(
      JSON.stringify({
        maintenance_runs: { self_update: '2026-11-01', bad: 1 },
        maintenance: { last_run_at: 5, last_result: 'updated' },
        rc_last_restart: 'x',
        auto_restarts: [1, 'y', 3],
        rc_dirs: ['rc', '../etc', 7, '.hidden'],
      }),
    );
    expect(s).toEqual({
      maintenance_runs: { self_update: '2026-11-01' },
      maintenance: { last_run_at: 5, last_result: 'updated' },
      auto_restarts: [1, 3],
      rc_dirs: ['rc'],
    });
  });
  it('ログ行の形', () => {
    expect(formatLogLine('info', '起動', { env: 'vm1', n: 1, skip: undefined }, new Date(0))).toBe(
      '1970-01-01T00:00:00.000Z INFO 起動 env=vm1 n=1',
    );
  });
});
