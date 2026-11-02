import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Command } from '@macmini/shared';
import type { ActionContext } from '../src/actions/context.js';
import { hostRestartAllowed, HOST_RESTART_MAX_AGE_MS } from '../src/actions/host.js';
import { executeCommand, validateCommand } from '../src/actions/index.js';
import { isValidSessionId } from '../src/actions/rc.js';
import { buildConfig, type AgentConfig } from '../src/config.js';
import type { ExecResult, Runner } from '../src/exec.js';
import { silentLogger } from '../src/log.js';
import { emptyState } from '../src/state.js';

/** 外部コマンドは実行せず、呼ばれた引数を記録して決め打ちの結果を返す */
interface Call {
  cmd: string;
  args: string[];
}

function fakeRunner(calls: Call[], respond: (c: Call) => Partial<ExecResult> = () => ({})): Runner {
  return async (cmd, args) => {
    const c = { cmd, args: [...args] };
    calls.push(c);
    return { code: 0, stdout: '', stderr: '', timedOut: false, ...respond(c) };
  };
}

function cfgFor(env: AgentConfig['env'], dir: string): AgentConfig {
  return buildConfig({
    env,
    settings: {
      base_url: 'https://mac.example.test',
      claude_path: '/opt/claude/bin/claude',
      tart_path: '/opt/homebrew/bin/tart',
    },
    token: { client_id: 'id', client_secret: 'secret' },
    home: '/Users/tester',
    uid: 501,
    configDir: dir,
  });
}

function ctxFor(cfg: AgentConfig, run: Runner, rcLog = 'remote control connected'): ActionContext {
  let now = 1_700_000_000_000;
  return {
    cfg,
    run,
    log: silentLogger,
    state: emptyState(),
    saveState() {},
    now: () => now,
    // 待ち時間は進めるだけで実際には待たない
    sleep: async (ms) => {
      now += ms;
    },
    readRcLogTail: () => rcLog,
  };
}

function cmd(partial: Partial<Command> & Pick<Command, 'action' | 'env' | 'executor'>): Command {
  return {
    id: 'c1',
    args: null,
    status: 'running',
    requested_by: 'owner',
    created_at: 1_700_000_000_000,
    not_before: null,
    expires_at: 1_700_000_600_000,
    started_at: null,
    finished_at: null,
    output: null,
    ...partial,
  };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'macmini-agent-test-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('ホワイトリストの検証', () => {
  it('実行者・対象・自分の環境を確かめる', () => {
    expect(
      validateCommand(cmd({ action: 'rc_restart', env: 'vm1', executor: 'vm1' }), 'vm1'),
    ).toBeNull();
    expect(
      validateCommand(cmd({ action: 'rc_restart', env: 'vm1', executor: 'vm1' }), 'host'),
    ).toMatch(/実行者/);
    expect(
      validateCommand(cmd({ action: 'vm_restart', env: 'vm1', executor: 'host' }), 'host'),
    ).toBeNull();
    expect(
      validateCommand(cmd({ action: 'vm_restart', env: 'host', executor: 'host' }), 'host'),
    ).toMatch(/対象/);
    expect(
      validateCommand(cmd({ action: 'host_restart', env: 'host', executor: 'vm1' }), 'vm1'),
    ).toMatch(/host/);
    expect(
      validateCommand(
        cmd({ action: 'rm -rf' as Command['action'], env: 'host', executor: 'host' }),
        'host',
      ),
    ).toMatch(/知らない/);
  });
  it('session_id は英数と -_ だけ', () => {
    expect(isValidSessionId('abc-DEF_123')).toBe(true);
    expect(isValidSessionId('a b')).toBe(false);
    expect(isValidSessionId('x; rm -rf /')).toBe(false);
    expect(isValidSessionId('')).toBe(false);
    expect(isValidSessionId(undefined)).toBe(false);
  });
});

describe('操作の実行（execFile の引数配列だけ）', () => {
  it('rc_restart は kickstart -k gui/<uid>/<label>', async () => {
    const calls: Call[] = [];
    const ctx = ctxFor(cfgFor('vm1', dir), fakeRunner(calls));
    const r = await executeCommand(
      cmd({ action: 'rc_restart', env: 'vm1', executor: 'vm1' }),
      ctx,
      {
        batch: [],
        sendResult: async () => true,
      },
    );
    expect(r.status).toBe('done');
    expect(calls).toEqual([
      { cmd: '/bin/launchctl', args: ['kickstart', '-k', 'gui/501/com.example.claude-rc'] },
    ]);
    expect(ctx.state.rc_last_restart).toBe(ctx.now());
  });

  it('claude_update は update → kickstart → 接続確認', async () => {
    const calls: Call[] = [];
    const ctx = ctxFor(cfgFor('vm1', dir), fakeRunner(calls));
    const r = await executeCommand(
      cmd({ action: 'claude_update', env: 'vm1', executor: 'vm1' }),
      ctx,
      {
        batch: [],
        sendResult: async () => true,
      },
    );
    expect(r.status).toBe('done');
    expect(calls.map((c) => [c.cmd, ...c.args])).toEqual([
      ['/opt/claude/bin/claude', 'update'],
      ['/bin/launchctl', 'kickstart', '-k', 'gui/501/com.example.claude-rc'],
    ]);
  });

  it('接続確認が 3 分で通らなければ failed', async () => {
    const ctx = ctxFor(cfgFor('vm1', dir), fakeRunner([]), 'reconnecting');
    const r = await executeCommand(
      cmd({ action: 'claude_update', env: 'vm1', executor: 'vm1' }),
      ctx,
      {
        batch: [],
        sendResult: async () => true,
      },
    );
    expect(r.status).toBe('failed');
    expect(r.output).toMatch(/3 分/);
  });

  it('session_restore は不正な id を実行しない', async () => {
    const calls: Call[] = [];
    const ctx = ctxFor(cfgFor('vm1', dir), fakeRunner(calls));
    const r = await executeCommand(
      cmd({
        action: 'session_restore',
        env: 'vm1',
        executor: 'vm1',
        args: { session_id: '$(id)' },
      }),
      ctx,
      { batch: [], sendResult: async () => true },
    );
    expect(r.status).toBe('failed');
    expect(calls).toEqual([]);
  });

  it('vm_stop は disable → bootout → tart stop、vm_start は enable → bootstrap', async () => {
    const calls: Call[] = [];
    const ctx = ctxFor(
      cfgFor('host', dir),
      fakeRunner(calls, (c) => (c.args[0] === 'ip' ? { stdout: '192.168.64.10\n' } : {})),
    );
    await executeCommand(cmd({ action: 'vm_stop', env: 'vm1', executor: 'host' }), ctx, {
      batch: [],
      sendResult: async () => true,
    });
    const r = await executeCommand(cmd({ action: 'vm_start', env: 'vm1', executor: 'host' }), ctx, {
      batch: [],
      sendResult: async () => true,
    });
    expect(r.status).toBe('done');
    expect(calls.map((c) => [c.cmd, ...c.args])).toEqual([
      ['/bin/launchctl', 'disable', 'gui/501/com.example.tart-vm1'],
      ['/bin/launchctl', 'bootout', 'gui/501/com.example.tart-vm1'],
      ['/opt/homebrew/bin/tart', 'stop', 'vm1'],
      ['/bin/launchctl', 'enable', 'gui/501/com.example.tart-vm1'],
      [
        '/bin/launchctl',
        'bootstrap',
        'gui/501',
        '/Users/tester/Library/LaunchAgents/com.example.tart-vm1.plist',
      ],
      ['/opt/homebrew/bin/tart', 'ip', 'vm1'],
    ]);
  });

  it('vm_restart は tart stop のあと IP が取れるまで待つ', async () => {
    const calls: Call[] = [];
    let ipCalls = 0;
    const ctx = ctxFor(
      cfgFor('host', dir),
      fakeRunner(calls, (c) =>
        c.args[0] === 'ip' ? (++ipCalls >= 3 ? { stdout: '192.168.64.10' } : { code: 1 }) : {},
      ),
    );
    const r = await executeCommand(
      cmd({ action: 'vm_restart', env: 'vm1', executor: 'host' }),
      ctx,
      {
        batch: [],
        sendResult: async () => true,
      },
    );
    expect(r.status).toBe('done');
    expect(calls.filter((c) => c.args[0] === 'ip')).toHaveLength(3);
  });

  it('host_restart は VM を止め、done を送ってから shutdown', async () => {
    const calls: Call[] = [];
    const sent: string[] = [];
    const ctx = ctxFor(cfgFor('host', dir), fakeRunner(calls));
    const c = cmd({
      action: 'host_restart',
      env: 'host',
      executor: 'host',
      not_before: ctx.now() - 1,
    });
    const r = await executeCommand(c, ctx, {
      batch: [c],
      sendResult: async (res) => {
        sent.push(res.status);
        // shutdown はまだ呼ばれていない
        expect(calls.some((x) => x.args.includes('-r'))).toBe(false);
        return true;
      },
    });
    expect(sent).toEqual(['done']);
    expect(r.status).toBe('done');
    expect(calls.map((c) => [c.cmd, ...c.args])).toEqual([
      ['/opt/homebrew/bin/tart', 'stop', 'vm1'],
      ['/opt/homebrew/bin/tart', 'stop', 'vm2'],
      ['/usr/bin/sudo', '-n', '/sbin/shutdown', '-r', 'now'],
    ]);
  });

  it('host_restart は result を送れなければ shutdown しない', async () => {
    const calls: Call[] = [];
    const ctx = ctxFor(cfgFor('host', dir), fakeRunner(calls));
    const c = cmd({ action: 'host_restart', env: 'host', executor: 'host' });
    const r = await executeCommand(c, ctx, { batch: [c], sendResult: async () => false });
    expect(r.status).toBe('failed');
    expect(calls.some((x) => x.cmd === '/usr/bin/sudo')).toBe(false);
  });

  it('失敗の output は要約だけ（パスを含めない・500 文字以内）', async () => {
    const ctx = ctxFor(
      cfgFor('vm1', dir),
      fakeRunner([], () => ({ code: 1, stderr: `error at /Users/tester/x ${'y'.repeat(900)}` })),
    );
    const r = await executeCommand(
      cmd({ action: 'rc_restart', env: 'vm1', executor: 'vm1' }),
      ctx,
      {
        batch: [],
        sendResult: async () => true,
      },
    );
    expect(r.status).toBe('failed');
    expect(r.output).not.toMatch(/\/Users/);
    expect((r.output ?? '').length).toBeLessThanOrEqual(500);
  });
});

describe('ホスト再起動の安全策', () => {
  const now = 1_700_000_000_000;
  const base = cmd({
    action: 'host_restart',
    env: 'host',
    executor: 'host',
    created_at: now - 60_000,
  });
  it('not_before 前・15 分超・より新しい指示がある、は実行しない', () => {
    expect(hostRestartAllowed({ ...base, not_before: now + 1 }, [base], now).ok).toBe(false);
    expect(
      hostRestartAllowed({ ...base, created_at: now - HOST_RESTART_MAX_AGE_MS - 1 }, [base], now)
        .ok,
    ).toBe(false);
    const newer = { ...base, id: 'c2', created_at: now - 1000 };
    expect(hostRestartAllowed(base, [base, newer], now).ok).toBe(false);
    expect(hostRestartAllowed(newer, [base, newer], now).ok).toBe(true);
    expect(hostRestartAllowed({ ...base, not_before: now - 1 }, [base], now).ok).toBe(true);
  });
});
