import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { Command } from '@agentstation/shared';
import type { ActionContext } from '../src/actions/context.js';
import { executeCommand } from '../src/actions/index.js';
import { rcMkdir } from '../src/actions/rcdirs.js';
import { buildRcDirs, filterAvailableDirs } from '../src/collect/rcdirs.js';
import type { TrustDeps } from '../src/claudetrust.js';
import { buildConfig } from '../src/config.js';
import { silentLogger, type Logger } from '../src/log.js';
import {
  classifyRcDirExit,
  RC_DIR_MAX_RESTARTS_PER_HOUR,
  RC_DIR_RESTART_DELAY_MS,
  RcDirManager,
  type ChildLike,
  type SpawnLike,
  type Timers,
} from '../src/rcdirs/manager.js';
import { findForbidden } from '../src/send/filter.js';
import { emptyState } from '../src/state.js';

describe('起動できるフォルダの一覧', () => {
  it('先頭ドット・不正名を除き、名前順、最大 100', () => {
    const names = [
      'zeta',
      '.git',
      'alpha',
      'rc',
      'bad/name',
      'alpha',
      ...Array.from({ length: 120 }, (_, i) => `p${String(i).padStart(3, '0')}`),
    ];
    const out = filterAvailableDirs(names);
    expect(out).toHaveLength(100);
    expect(out.slice(0, 2)).toEqual(['alpha', 'p000']);
    expect(out).not.toContain('.git');
    expect(out).not.toContain('bad/name');
    expect(filterAvailableDirs(null)).toEqual([]);
  });
  it('root は作業フォルダの最後の要素。パスは出ない', () => {
    const d = buildRcDirs('/Users/taro/workspace', ['rc', 'agentstation'], []);
    expect(d).toEqual({ root: 'workspace', available: ['agentstation', 'rc'], running: [] });
    expect(findForbidden({ rc_dirs: d })).toEqual([]);
  });
});

// ---------- 偽の子プロセスとタイマー ----------

class FakeChild extends EventEmitter implements ChildLike {
  pid = 1000 + Math.floor(Math.random() * 1000);
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed: NodeJS.Signals | undefined;
  kill(signal?: NodeJS.Signals): boolean {
    this.killed = signal ?? 'SIGTERM';
    return true;
  }
  /** stderr に書いてから exit させる */
  exitWith(code: number | null, stderrText = ''): void {
    if (stderrText) this.stderr.write(stderrText);
    setImmediate(() => this.emit('exit', code, null));
  }
}

class FakeTimers implements Timers {
  pending: { cb: () => void; ms: number; id: number }[] = [];
  private seq = 0;
  set(cb: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.pending.push({ cb, ms, id });
    return id;
  }
  clear(handle: unknown): void {
    this.pending = this.pending.filter((p) => p.id !== handle);
  }
  fireAll(): void {
    const ps = this.pending;
    this.pending = [];
    for (const p of ps) p.cb();
  }
}

const tick = () => new Promise((r) => setImmediate(r));

/** 信頼の記録の偽物（~/.claude.json には触らない） */
function fakeTrust(): TrustDeps {
  const files = new Map<string, string>();
  return {
    exists: () => true,
    realpath: (p) => p,
    read: (p) => files.get(p) ?? null,
    write: (p, t) => {
      files.set(p, t);
    },
  };
}

function setup(opts: { exists?: (p: string) => boolean; log?: Logger } = {}) {
  const spawned: { cmd: string; args: string[]; cwd: string; child: FakeChild }[] = [];
  const spawn: SpawnLike = (cmd, args, o) => {
    const child = new FakeChild();
    spawned.push({ cmd, args: [...args], cwd: o.cwd, child });
    return child;
  };
  const timers = new FakeTimers();
  let now = 1_700_000_000_000;
  const mgr = new RcDirManager({
    workDir: '/Users/t/workspace',
    claudePath: '/opt/claude/bin/claude',
    logDir: '/Users/t/Library/Logs',
    log: opts.log ?? silentLogger,
    spawn,
    exists: opts.exists ?? (() => true),
    timers,
    now: () => now,
  });
  return { mgr, spawned, timers, advance: (ms: number) => (now += ms) };
}

describe('RcDirManager', () => {
  it('spawn の引数と cwd。シェルは使わず、--name と --debug-file を付ける', () => {
    const { mgr, spawned } = setup();
    expect(mgr.start('agentstation', 'c1')).toEqual({ ok: true, already: false });
    expect(spawned).toHaveLength(1);
    expect(spawned[0]).toMatchObject({
      cmd: '/opt/claude/bin/claude',
      args: [
        'remote-control',
        '--name',
        'agentstation',
        '--permission-mode',
        'bypassPermissions',
        '--debug-file',
        '/Users/t/Library/Logs/claude-rc-agentstation.log',
      ],
      cwd: '/Users/t/workspace/agentstation',
    });
    expect(mgr.desired()).toEqual(['agentstation']);
    // 2 回目は already
    expect(mgr.start('agentstation', 'c1')).toEqual({ ok: true, already: true });
    expect(spawned).toHaveLength(1);
  });

  it('不正な dir・work_dir の外・存在しないフォルダは起動しない', () => {
    const { mgr, spawned } = setup({ exists: (p) => !p.endsWith('/missing') });
    expect(mgr.start('../etc', 'c1')).toEqual({ ok: false, reason: 'invalid dir' });
    expect(mgr.start('a/b', 'c1')).toEqual({ ok: false, reason: 'invalid dir' });
    expect(mgr.start('.hidden', 'c1')).toEqual({ ok: false, reason: 'invalid dir' });
    expect(mgr.start('missing', 'c1')).toEqual({ ok: false, reason: 'missing' });
    expect(spawned).toHaveLength(0);
    expect(mgr.resolveDir('rc')).toBe('/Users/t/workspace/rc');
    expect(mgr.resolveDir('..')).toBeNull();
  });

  it('snapshot：starting → ログが connected なら running。パスは載せない', () => {
    const { mgr } = setup();
    mgr.start('rc', 'c1');
    expect(mgr.snapshot()).toEqual([
      { dir: 'rc', state: 'starting', name: 'rc', started_at: 1_700_000_000_000 },
    ]);
    expect(mgr.snapshot((d) => d === 'rc')[0]?.state).toBe('running');
    expect(
      findForbidden({ rc_dirs: { root: 'workspace', available: [], running: mgr.snapshot() } }),
    ).toEqual([]);
  });

  it('終了したら 30 秒後に再起動。1 時間に 5 回を超えたら error', async () => {
    const { mgr, spawned, timers, advance } = setup();
    mgr.start('rc', 'c1');
    for (let i = 0; i < RC_DIR_MAX_RESTARTS_PER_HOUR; i++) {
      spawned[spawned.length - 1]!.child.exitWith(1);
      await tick();
      expect(mgr.snapshot()[0]).toMatchObject({ state: 'stopped', detail: 'exit 1' });
      expect(timers.pending).toHaveLength(1);
      expect(timers.pending[0]!.ms).toBe(RC_DIR_RESTART_DELAY_MS);
      advance(RC_DIR_RESTART_DELAY_MS);
      timers.fireAll();
      expect(spawned).toHaveLength(i + 2);
    }
    spawned[spawned.length - 1]!.child.exitWith(1);
    await tick();
    expect(mgr.snapshot()[0]).toMatchObject({ state: 'error', detail: 'restart limit' });
    expect(timers.pending).toHaveLength(0);
    // 希望集合には残る（手で start し直せば再開）
    expect(mgr.desired()).toEqual(['rc']);
    expect(mgr.start('rc', 'c1')).toEqual({ ok: true, already: false });
    expect(spawned).toHaveLength(RC_DIR_MAX_RESTARTS_PER_HOUR + 2);
  });

  it('Workspace not trusted なら再起動せず error / not trusted', async () => {
    const { mgr, spawned, timers } = setup();
    mgr.start('untrusted', 'c1');
    spawned[0]!.child.exitWith(
      1,
      'Error: Workspace not trusted. Please run `claude` in /Users/t/workspace/untrusted first and accept the trust dialog.\n',
    );
    await tick();
    const snap = mgr.snapshot();
    expect(snap[0]).toEqual({
      dir: 'untrusted',
      state: 'error',
      name: 'untrusted',
      started_at: 1_700_000_000_000,
      detail: 'not trusted',
    });
    expect(timers.pending).toHaveLength(0);
    expect(findForbidden({ running: snap })).toEqual([]);
  });

  it('同意のプロンプトが出たら stdin に y を書いて続行し、ログに指示 id を残す', async () => {
    const lines: string[] = [];
    const { mgr, spawned, timers } = setup({
      log: { info: (m) => lines.push(m), warn() {}, error() {} },
    });
    mgr.start('rc', 'cmd-123');
    const child = spawned[0]!.child;
    let written = '';
    child.stdin.on('data', (c) => (written += String(c)));
    child.stdout.write('Enable Remote Control? (y/n) ');
    await tick();
    expect(written).toBe('y\n');
    expect(lines).toContain('同意プロンプトに y を入力（指示 cmd-123 による）');
    // プロセスは続行。1 プロセスにつき 1 回だけ書く
    child.stdout.write('Enable Remote Control? (y/n) ');
    await tick();
    expect(written).toBe('y\n');
    expect(mgr.snapshot()[0]).toMatchObject({ state: 'starting' });
    expect(timers.pending).toHaveLength(0);
    // 復元からの起動は source が state.json
    const other = setup({ log: { info: (m) => lines.push(m), warn() {}, error() {} } });
    other.mgr.restore(['a']);
    other.spawned[0]!.child.stderr.write('Enable Remote Control? (y/n)');
    await tick();
    expect(lines).toContain('同意プロンプトに y を入力（指示 state.json による）');
  });

  it('stop は SIGTERM して集合から外す。遅れて来た exit は無視', async () => {
    const { mgr, spawned, timers } = setup();
    mgr.start('rc', 'c1');
    expect(mgr.stop('rc')).toEqual({ ok: true, wasRunning: true });
    expect(spawned[0]!.child.killed).toBe('SIGTERM');
    expect(mgr.desired()).toEqual([]);
    expect(mgr.snapshot()).toEqual([]);
    spawned[0]!.child.exitWith(null);
    await tick();
    expect(mgr.snapshot()).toEqual([]);
    expect(timers.pending).toHaveLength(0);
    expect(mgr.stop('rc')).toEqual({ ok: true, wasRunning: false });
  });

  it('restore で戻し、shutdown で全部止める', () => {
    const { mgr, spawned } = setup();
    mgr.restore(['a', 'b', '../x']);
    expect(mgr.desired()).toEqual(['a', 'b']);
    expect(spawned.map((s) => s.cwd)).toEqual(['/Users/t/workspace/a', '/Users/t/workspace/b']);
    expect(mgr.logPaths()).toEqual([
      '/Users/t/Library/Logs/claude-rc-a.log',
      '/Users/t/Library/Logs/claude-rc-b.log',
    ]);
    mgr.shutdown();
    expect(spawned.every((s) => s.child.killed === 'SIGTERM')).toBe(true);
  });

  it('終了理由の判定（純粋関数）', () => {
    expect(classifyRcDirExit('', 2, null)).toEqual({ fatal: false, detail: 'exit 2' });
    expect(classifyRcDirExit('', null, null)).toEqual({ fatal: false, detail: 'killed' });
    expect(classifyRcDirExit('', null, 'ENOENT')).toEqual({ fatal: false, detail: 'ENOENT' });
    expect(classifyRcDirExit('Workspace not trusted', 1, null).fatal).toBe(true);
    // 同意プロンプトは致命ではない（stdin に y を書いて続行する）
    expect(classifyRcDirExit('Enable Remote Control? (y/n)', 0, null).fatal).toBe(false);
  });
});

describe('rc_start_dir / rc_stop_dir', () => {
  function ctxFor(mgr: RcDirManager | undefined): ActionContext & { saved: number } {
    const cfg = buildConfig({
      env: 'host',
      settings: {
        base_url: 'https://x.example.test',
        claude_path: '/opt/claude/bin/claude',
        tart_path: '/opt/homebrew/bin/tart',
      },
      token: { client_id: 'a', client_secret: 'b' },
      home: '/Users/t',
      uid: 501,
      configDir: '/Users/t/.config/agentstation',
    });
    const ctx = {
      cfg,
      run: async () => ({ code: 0, stdout: '', stderr: '', timedOut: false }),
      log: silentLogger,
      state: emptyState(),
      saved: 0,
      saveState() {
        ctx.saved++;
      },
      now: () => 0,
      sleep: async () => {},
      readRcLogTail: () => '',
      trust: fakeTrust(),
      ...(mgr ? { rcDirs: mgr } : {}),
    };
    return ctx;
  }
  const cmd = (action: Command['action'], dir: unknown): Command => ({
    id: 'c1',
    env: 'host',
    executor: 'host',
    action,
    args: { dir: dir as string },
    status: 'running',
    requested_by: 'o',
    created_at: 0,
    not_before: null,
    expires_at: 1,
    started_at: null,
    finished_at: null,
    output: null,
  });
  const opts = { batch: [], sendResult: async () => true };

  it('起動して希望集合を state に保存。停止で外す', async () => {
    const { mgr, spawned } = setup();
    const ctx = ctxFor(mgr);
    const r1 = await executeCommand(cmd('rc_start_dir', 'rc'), ctx, opts);
    expect(r1.status).toBe('done');
    expect(spawned).toHaveLength(1);
    expect(ctx.state.rc_dirs).toEqual(['rc']);
    expect(ctx.saved).toBe(1);
    const r2 = await executeCommand(cmd('rc_start_dir', 'rc'), ctx, opts);
    expect(r2).toMatchObject({ status: 'done', output: 'rc は既に動いている' });
    const r3 = await executeCommand(cmd('rc_stop_dir', 'rc'), ctx, opts);
    expect(r3.status).toBe('done');
    expect(ctx.state.rc_dirs).toEqual([]);
    expect(spawned[0]!.child.killed).toBe('SIGTERM');
  });
  it('不正な dir と manager 無しは failed', async () => {
    const { mgr, spawned } = setup();
    expect((await executeCommand(cmd('rc_start_dir', '../etc'), ctxFor(mgr), opts)).status).toBe(
      'failed',
    );
    expect((await executeCommand(cmd('rc_start_dir', undefined), ctxFor(mgr), opts)).status).toBe(
      'failed',
    );
    expect(spawned).toHaveLength(0);
    expect((await executeCommand(cmd('rc_start_dir', 'rc'), ctxFor(undefined), opts)).status).toBe(
      'failed',
    );
  });
});

describe('rc_mkdir', () => {
  function ctxFor(mgr: RcDirManager): ActionContext & { saved: number } {
    const cfg = buildConfig({
      env: 'host',
      settings: {
        base_url: 'https://x.example.test',
        claude_path: '/opt/claude/bin/claude',
        tart_path: '/opt/homebrew/bin/tart',
        work_dir: '/Users/t/workspace',
      },
      token: { client_id: 'a', client_secret: 'b' },
      home: '/Users/t',
      uid: 501,
      configDir: '/Users/t/.config/agentstation',
    });
    const ctx = {
      cfg,
      run: async () => ({ code: 0, stdout: '', stderr: '', timedOut: false }),
      log: silentLogger,
      state: emptyState(),
      saved: 0,
      saveState() {
        ctx.saved++;
      },
      now: () => 0,
      sleep: async () => {},
      readRcLogTail: () => '',
      trust: fakeTrust(),
      rcDirs: mgr,
    };
    return ctx;
  }
  function fakeFs() {
    const made: string[] = [];
    return {
      made,
      deps: {
        exists: (p: string) => p === '/Users/t/workspace' || made.includes(p),
        mkdir: (p: string) => {
          made.push(p);
        },
      },
    };
  }

  it('作業フォルダ直下に作る。既にあるなら failed。start で続けて起動し state に残す', async () => {
    const { mgr, spawned } = setup();
    const ctx = ctxFor(mgr);
    const { made, deps } = fakeFs();
    const r1 = await rcMkdir(ctx, 'new-proj', false, 'c1', deps);
    expect(r1).toEqual({ ok: true, summary: 'new-proj を作成した' });
    expect(made).toEqual(['/Users/t/workspace/new-proj']);
    expect(spawned).toHaveLength(0);
    expect((await rcMkdir(ctx, 'new-proj', false, 'c1', deps)).ok).toBe(false);

    const r2 = await rcMkdir(ctx, 'proj2', true, 'c2', deps);
    expect(r2.ok).toBe(true);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.cwd).toBe('/Users/t/workspace/proj2');
    expect(ctx.state.rc_dirs).toEqual(['proj2']);
    expect(ctx.saved).toBe(1);
  });
  it('不正な名前・先頭ドット・パスは作らない', async () => {
    const { mgr } = setup();
    const ctx = ctxFor(mgr);
    const { made, deps } = fakeFs();
    for (const bad of ['../x', '.hidden', 'a/b', '', undefined, 'x'.repeat(65)]) {
      expect((await rcMkdir(ctx, bad, false, 'c', deps)).ok).toBe(false);
    }
    expect(made).toEqual([]);
  });
  it('mkdir の失敗は failed で、ファイルシステムの文言は出さない', async () => {
    const { mgr } = setup();
    const ctx = ctxFor(mgr);
    const deps = {
      exists: (p: string) => p === '/Users/t/workspace',
      mkdir: () => {
        throw new Error('EACCES: permission denied, mkdir /Users/t/workspace/x');
      },
    };
    expect(await rcMkdir(ctx, 'x', false, 'c', deps)).toEqual({
      ok: false,
      summary: 'x を作れなかった',
    });
  });
});
