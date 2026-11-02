import { createExecutionContext, env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import { runCron } from '../src/cron/index.js';
import type { Bindings } from '../src/env.js';
import { agentToken, hostHeartbeat, mockJwks, userToken, uuid, vmHeartbeat } from './helpers.js';

/**
 * VM の台数（0〜2 台）。使う VM は MEMBERS_JSON.envs に書いたものだけ。
 * SELF の環境変数は固定なので、ここでは Worker の fetch を環境変数を差し替えて直接呼ぶ。
 */

const OWNER = 'taro@example.test';
const members = (envs: Record<string, string>) =>
  JSON.stringify({ owner: OWNER, envs: { host: OWNER, ...envs }, viewers: [] });
const NO_VM: Bindings = { ...env, MEMBERS_JSON: members({}) };
const VM2_ONLY: Bindings = { ...env, MEMBERS_JSON: members({ vm2: 'jiro@example.test' }) };

async function call(
  bindings: Bindings,
  path: string,
  init: { token: string; body?: unknown; method?: string },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const req = new Request(`https://mac.example.test${path}`, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    headers: {
      'Cf-Access-Jwt-Assertion': init.token,
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const res = await worker.fetch(req, bindings, createExecutionContext());
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeAll(mockJwks);
beforeEach(async () => {
  await env.DB.exec('DELETE FROM heartbeats; DELETE FROM commands; DELETE FROM notify_state;');
});

describe('VM なし（host だけ）', () => {
  it('/api/me と /api/status は host だけを返す', async () => {
    const token = await userToken(OWNER);
    const me = await call(NO_VM, '/api/me', { token });
    expect(me.body.enabled_envs).toEqual(['host']);
    expect(me.body.envs).toEqual(['host']);
    const st = await call(NO_VM, '/api/status', { token });
    expect((st.body.envs as { env: string }[]).map((e) => e.env)).toEqual(['host']);
  });

  it('使っていない VM への指示は 400', async () => {
    const token = await userToken(OWNER);
    const r = await call(NO_VM, '/api/commands', {
      token,
      body: { id: uuid(), env: 'vm1', action: 'rc_restart' },
    });
    expect(r.status).toBe(400);
  });

  it('使っていない VM のトークンからの報告は 403。AGENT_TOKEN_NAMES に VM が無くても host は報告できる', async () => {
    const hostOnlyTokens: Bindings = { ...NO_VM, AGENT_TOKEN_NAMES: '{"host":"tok-host"}' };
    const vm = await call(NO_VM, '/api/agent/heartbeat', {
      token: await agentToken('tok-vm1'),
      body: vmHeartbeat('vm1'),
    });
    expect(vm.status).toBe(403);
    const host = await call(hostOnlyTokens, '/api/agent/heartbeat', {
      token: await agentToken('tok-host'),
      body: hostHeartbeat({ vms: [] }),
    });
    expect(host.status).toBe(200);
  });
});

describe('vm2 だけ', () => {
  it('host が vm1 の様子を送ってきても保存せず、一覧は host と vm2', async () => {
    const r = await call(VM2_ONLY, '/api/agent/heartbeat', {
      token: await agentToken('tok-host'),
      body: hostHeartbeat(),
    });
    expect(r.status).toBe(200);
    expect(Object.keys((r.body.peers as object) ?? {})).not.toContain('vm1');
    const st = await call(VM2_ONLY, '/api/status', { token: await userToken(OWNER) });
    const envs = st.body.envs as { env: string; vm_view: { env: string } | null }[];
    expect(envs.map((e) => e.env)).toEqual(['host', 'vm2']);
    expect(envs[1]?.vm_view?.env).toBe('vm2');
  });

  it('使っていない vm1 の停止は通知しない（vm2 の停止は観測する）', async () => {
    const now = Date.now();
    await call(VM2_ONLY, '/api/agent/heartbeat', {
      token: await agentToken('tok-host'),
      body: hostHeartbeat({
        vms: [
          { env: 'vm1', vm_state: 'stopped', usage: {}, alloc: {} },
          { env: 'vm2', vm_state: 'stopped', usage: {}, alloc: {} },
        ],
      }),
    });
    await runCron(VM2_ONLY, now);
    const keys = (
      await env.DB.prepare('SELECT key FROM notify_state').all<{ key: string }>()
    ).results.map((r) => r.key);
    expect(keys).toContain('vm_stopped:vm2');
    expect(keys).not.toContain('vm_stopped:vm1');
  });
});

describe('GET /api/agent/whoami（kit/doctor.mjs）', () => {
  it('トークンの環境と最後の報告の時刻だけを返し、指示は受け取らない', async () => {
    const before = await call(env, '/api/agent/whoami', { token: await agentToken('tok-vm1') });
    expect(before.status).toBe(200);
    expect(before.body.env).toBe('vm1');
    expect(before.body.last_received_at).toBeNull();
    await call(env, '/api/agent/heartbeat', {
      token: await agentToken('tok-vm1'),
      body: vmHeartbeat('vm1'),
    });
    const after = await call(env, '/api/agent/whoami', { token: await agentToken('tok-vm1') });
    expect(typeof after.body.last_received_at).toBe('number');
  });
});
