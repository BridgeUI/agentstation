import { describe, expect, it } from 'vitest';
import type { Command } from '@agentstation/shared';
import { executeCommand } from '../src/actions/index.js';
import { hostRestartPrepare } from '../src/actions/host.js';
import type { ActionContext } from '../src/actions/context.js';
import { buildConfig } from '../src/config.js';
import { CpuSampler, collectHost } from '../src/collect/host.js';
import { VmProcessResolver } from '../src/collect/vmproc.js';
import type { Runner } from '../src/exec.js';
import { silentLogger } from '../src/log.js';
import { maintenanceTasksFor } from '../src/maintenance/schedule.js';
import { emptyState } from '../src/state.js';

/** VM の台数（設定 vms。0〜2 台、省略時は両方） */

const base = {
  base_url: 'https://mac.example.test',
  claude_path: '/opt/claude/bin/claude',
  tart_path: '/opt/homebrew/bin/tart',
};
const cfgWith = (settings: Record<string, unknown>) =>
  buildConfig({
    env: 'host',
    settings: { ...base, ...settings },
    token: { client_id: 'id', client_secret: 'secret' },
    home: '/Users/tester',
    uid: 501,
    configDir: '/tmp/agentstation-test',
  });

function recorder(): { calls: string[]; run: Runner } {
  const calls: string[] = [];
  return {
    calls,
    run: async (cmd, args) => {
      calls.push([cmd, ...args].join(' '));
      return { code: 0, stdout: '', stderr: '', timedOut: false };
    },
  };
}

function ctxFor(settings: Record<string, unknown>, run: Runner): ActionContext {
  let now = 1_700_000_000_000;
  return {
    cfg: cfgWith(settings),
    run,
    log: silentLogger,
    state: emptyState(),
    saveState() {},
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    readRcLogTail: () => '',
  };
}

describe('設定 vms', () => {
  it('省略時は vm1・vm2 の両方（これまでの導入と同じ）', () => {
    expect(cfgWith({}).vms).toEqual(['vm1', 'vm2']);
  });
  it('[] なら VM なしで、tart_path も要らない', () => {
    const noTart: Record<string, unknown> = { ...base };
    delete noTart.tart_path;
    const cfg = buildConfig({
      env: 'host',
      settings: { ...noTart, vms: [] },
      token: { client_id: 'id', client_secret: 'secret' },
      home: '/Users/tester',
      uid: 501,
      configDir: '/tmp/x',
    });
    expect(cfg.vms).toEqual([]);
    expect(cfg.tartPath).toBeNull();
  });
  it('並びは vm1 → vm2 に揃え、知らない名前は弾く', () => {
    expect(cfgWith({ vms: ['vm2', 'vm1'] }).vms).toEqual(['vm1', 'vm2']);
    expect(() => cfgWith({ vms: ['vm3'] })).toThrow(/vms/);
  });
});

describe('VM の台数に合わせた動き', () => {
  it('夜間メンテは使っている VM の枠だけ', () => {
    expect(maintenanceTasksFor('host', ['vm2']).map((t) => t.key)).toEqual([
      'vm_restart:vm2',
      'self_update',
    ]);
    expect(maintenanceTasksFor('host', []).map((t) => t.key)).toEqual(['self_update']);
  });

  it('VM なしの host は tart を呼ばずに報告を作る', async () => {
    const { calls, run } = recorder();
    const out = await collectHost(
      run,
      cfgWith({ vms: [] }),
      new CpuSampler(),
      new VmProcessResolver(),
    );
    expect(out.vms).toEqual([]);
    expect(calls.some((c) => c.includes('tart'))).toBe(false);
  });

  it('ホスト再起動の前に止めるのは使っている VM だけ', async () => {
    const { calls, run } = recorder();
    const r = await hostRestartPrepare(ctxFor({ vms: ['vm1'] }, run));
    expect(r.ok).toBe(true);
    expect(calls.filter((c) => c.includes(' stop '))).toEqual(['/opt/homebrew/bin/tart stop vm1']);
  });

  it('設定に無い VM への操作は実行しない', async () => {
    const { calls, run } = recorder();
    const c: Command = {
      id: 'c1',
      env: 'vm2',
      action: 'vm_restart',
      executor: 'host',
      args: null,
      status: 'running',
      requested_by: 'owner',
      created_at: 1_700_000_000_000,
      not_before: null,
      expires_at: 1_700_000_600_000,
      started_at: null,
      finished_at: null,
      output: null,
    };
    const r = await executeCommand(c, ctxFor({ vms: ['vm1'] }, run), {
      batch: [c],
      sendResult: async () => true,
    });
    expect(r.status).toBe('failed');
    expect(calls).toEqual([]);
  });
});
