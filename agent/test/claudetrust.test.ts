import { describe, expect, it } from 'vitest';
import type { Command } from '@agentstation/shared';
import type { ActionContext } from '../src/actions/context.js';
import { executeCommand } from '../src/actions/index.js';
import { rcMkdir } from '../src/actions/rcdirs.js';
import {
  applyProjectTrust,
  applyRemoteControlConsent,
  prepareMainRc,
  type TrustDeps,
} from '../src/claudetrust.js';
import { buildConfig } from '../src/config.js';
import { silentLogger } from '../src/log.js';
import { emptyState } from '../src/state.js';

describe('applyRemoteControlConsent / prepareMainRc', () => {
  it('remoteDialogSeen を立てる。既にあれば書かない。壊れた JSON は触らない', () => {
    const r = applyRemoteControlConsent(JSON.stringify({ numStartups: 3 }));
    if (!r.ok) throw new Error(r.reason);
    expect(r.changed).toBe(true);
    expect(JSON.parse(r.text)).toEqual({ numStartups: 3, remoteDialogSeen: true });
    const again = applyRemoteControlConsent(r.text);
    expect(again.ok && !again.changed).toBe(true);
    expect(applyRemoteControlConsent('{oops').ok).toBe(false);
  });

  it('作業フォルダの信頼と同意をまとめて 1 回で書く。揃っていれば書かない。フォルダが無ければ同意だけ', () => {
    const files = new Map<string, string>();
    const writes: string[] = [];
    const deps: TrustDeps = {
      exists: (p) => p === '/Users/t/workspace',
      realpath: (p) => p,
      read: (p) => files.get(p) ?? null,
      write: (p, t) => {
        files.set(p, t);
        writes.push(p);
      },
    };
    const first = prepareMainRc(deps, '/Users/t/.claude.json', '/Users/t/workspace');
    expect(first).toEqual({ ok: true, trusted: true, consented: true });
    expect(writes).toHaveLength(1);
    const o = JSON.parse(files.get('/Users/t/.claude.json') ?? '') as Record<string, unknown>;
    expect(o.remoteDialogSeen).toBe(true);
    expect(
      (o.projects as Record<string, Record<string, unknown>>)['/Users/t/workspace'],
    ).toMatchObject({ hasTrustDialogAccepted: true });

    expect(prepareMainRc(deps, '/Users/t/.claude.json', '/Users/t/workspace')).toEqual({
      ok: true,
      trusted: false,
      consented: false,
    });
    expect(writes).toHaveLength(1);

    files.clear();
    expect(prepareMainRc(deps, '/Users/t/.claude.json', '/Users/t/missing')).toEqual({
      ok: true,
      trusted: false,
      consented: true,
    });
    expect(JSON.parse(files.get('/Users/t/.claude.json') ?? '')).toEqual({
      remoteDialogSeen: true,
    });
  });
});

describe('applyProjectTrust', () => {
  it('無ければ projects と項目を作る。信頼フラグは true', () => {
    const r = applyProjectTrust(null, '/Users/t/workspace/panda');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changed).toBe(true);
    const o = JSON.parse(r.text) as { projects: Record<string, Record<string, unknown>> };
    expect(o.projects['/Users/t/workspace/panda']).toMatchObject({
      hasTrustDialogAccepted: true,
      allowedTools: [],
      mcpServers: {},
    });
  });

  it('ほかのキー・ほかのフォルダの項目・その項目の他のキーは残す', () => {
    const before = JSON.stringify({
      oauthAccount: { emailAddress: 'x@example.test' },
      numStartups: 12,
      projects: {
        '/Users/t/workspace': { hasTrustDialogAccepted: true, allowedTools: ['Bash(git *)'] },
        '/Users/t/workspace/panda': { allowedTools: [], lastCost: 1.5 },
      },
    });
    const r = applyProjectTrust(before, '/Users/t/workspace/panda');
    if (!r.ok) throw new Error(r.reason);
    expect(r.changed).toBe(true);
    expect(JSON.parse(r.text)).toEqual({
      oauthAccount: { emailAddress: 'x@example.test' },
      numStartups: 12,
      projects: {
        '/Users/t/workspace': { hasTrustDialogAccepted: true, allowedTools: ['Bash(git *)'] },
        '/Users/t/workspace/panda': {
          allowedTools: [],
          lastCost: 1.5,
          hasTrustDialogAccepted: true,
        },
      },
    });
  });

  it('既に信頼済みなら changed=false で書き換えない', () => {
    const before = JSON.stringify({
      projects: { '/Users/t/workspace/panda': { hasTrustDialogAccepted: true } },
    });
    const r = applyProjectTrust(before, '/Users/t/workspace/panda');
    if (!r.ok) throw new Error(r.reason);
    expect(r.changed).toBe(false);
    expect(r.text).toBe(before);
  });

  it('壊れた JSON・形が不正なものは書き換えない', () => {
    expect(applyProjectTrust('{oops', '/x').ok).toBe(false);
    expect(applyProjectTrust('[]', '/x').ok).toBe(false);
    expect(applyProjectTrust(JSON.stringify({ projects: [] }), '/x').ok).toBe(false);
    expect(applyProjectTrust(JSON.stringify({ projects: { '/x': 'yes' } }), '/x').ok).toBe(false);
  });
});

/** 起動は必ず信頼を記録してから（docs/spec.md 13章 #21） */
describe('rc_start_dir / rc_mkdir は起動の前に信頼を記録する', () => {
  function fakeManager() {
    const calls: { start: string[]; stop: string[] } = { start: [], stop: [] };
    const running = new Set<string>();
    const mgr: NonNullable<ActionContext['rcDirs']> = {
      start(dir: string) {
        calls.start.push(dir);
        const already = running.has(dir);
        running.add(dir);
        return { ok: true as const, already };
      },
      stop(dir: string) {
        calls.stop.push(dir);
        return { ok: true as const, wasRunning: running.delete(dir) };
      },
      desired: () => [...running].sort(),
    };
    return { mgr, calls, running };
  }
  function fakeTrust(
    initial: string | null,
    opts: { exists?: boolean; writeFails?: boolean } = {},
  ) {
    const files = new Map<string, string>();
    if (initial !== null) files.set('/Users/t/.claude.json', initial);
    const writes: string[] = [];
    const deps: TrustDeps = {
      exists: () => opts.exists ?? true,
      realpath: (p) => p.replace('/Users/t/workspace', '/Volumes/Data/workspace'),
      read: (p) => files.get(p) ?? null,
      write: (p, text) => {
        if (opts.writeFails) throw new Error('EACCES');
        writes.push(p);
        files.set(p, text);
      },
    };
    return { deps, files, writes };
  }
  function ctxFor(
    mgr: ActionContext['rcDirs'],
    trust: TrustDeps,
  ): ActionContext & { saved: number; logs: string[] } {
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
      log: {
        ...silentLogger,
        info: (msg: string) => {
          ctx.logs.push(msg);
        },
      },
      state: emptyState(),
      saved: 0,
      logs: [] as string[],
      saveState() {
        ctx.saved++;
      },
      now: () => 0,
      sleep: async () => {},
      readRcLogTail: () => '',
      trust,
      ...(mgr ? { rcDirs: mgr } : {}),
    };
    return ctx;
  }
  const cmd = (dir: unknown): Command => ({
    id: 'cmd-1',
    env: 'host',
    executor: 'host',
    action: 'rc_start_dir',
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

  it('実体パスで信頼フラグを書いてから起動し、state に残す。ログに指示 id', async () => {
    const { mgr, calls } = fakeManager();
    const { deps, files, writes } = fakeTrust(JSON.stringify({ projects: {} }));
    const ctx = ctxFor(mgr, deps);
    const r = await executeCommand(cmd('panda'), ctx, opts);
    expect(r).toMatchObject({
      status: 'done',
      output: 'panda を信頼済みにして Remote Control を起動した',
    });
    expect(writes).toEqual(['/Users/t/.claude.json']);
    const o = JSON.parse(files.get('/Users/t/.claude.json')!) as {
      projects: Record<string, { hasTrustDialogAccepted: boolean }>;
    };
    expect(o.projects['/Volumes/Data/workspace/panda']?.hasTrustDialogAccepted).toBe(true);
    expect(calls.start).toEqual(['panda']);
    expect(ctx.state.rc_dirs).toEqual(['panda']);
    expect(ctx.saved).toBe(1);
    expect(ctx.logs.some((m) => m.includes('cmd-1'))).toBe(true);
  });

  it('既に信頼済みなら書かずに起動だけ。既に動いていればその旨', async () => {
    const { mgr, running } = fakeManager();
    const { deps, writes } = fakeTrust(
      JSON.stringify({
        projects: { '/Volumes/Data/workspace/panda': { hasTrustDialogAccepted: true } },
      }),
    );
    const ctx = ctxFor(mgr, deps);
    const r1 = await executeCommand(cmd('panda'), ctx, opts);
    expect(r1).toMatchObject({ status: 'done', output: 'panda で Remote Control を起動した' });
    expect(writes).toEqual([]);
    expect(running.has('panda')).toBe(true);
    const r2 = await executeCommand(cmd('panda'), ctx, opts);
    expect(r2).toMatchObject({ status: 'done', output: 'panda は既に動いている' });
  });

  it('信頼を記録できなければ起動しない（無いフォルダ・書けない・壊れた JSON・manager 無し）', async () => {
    const { mgr, calls } = fakeManager();
    const ok = fakeTrust(null);
    const run = (dir: unknown, trust: TrustDeps, m: ActionContext['rcDirs'] = mgr) =>
      executeCommand(cmd(dir), ctxFor(m, trust), opts);
    expect((await run('../etc', ok.deps)).status).toBe('failed');
    expect((await run('nope', fakeTrust(null, { exists: false }).deps)).status).toBe('failed');
    const w = await run('panda', fakeTrust(null, { writeFails: true }).deps);
    expect(w).toMatchObject({
      status: 'failed',
      output: '起動できない: ~/.claude.json を書けなかった',
    });
    const broken = await run('panda', fakeTrust('{oops').deps);
    expect(broken.status).toBe('failed');
    expect(broken.output).toContain('JSON');
    // manager 無し（第 3 引数に undefined を渡すと既定値になるので直接組み立てる）
    expect((await executeCommand(cmd('panda'), ctxFor(undefined, ok.deps), opts)).status).toBe(
      'failed',
    );
    expect(calls.start).toEqual([]);
  });

  it('rc_mkdir の「作成後に起動」も信頼を記録してから起動する', async () => {
    const { mgr, calls } = fakeManager();
    const { deps, writes } = fakeTrust(null);
    const ctx = ctxFor(mgr, deps);
    const made: string[] = [];
    const r = await rcMkdir(ctx, 'fresh', true, 'cmd-2', {
      exists: (p) => p === '/Users/t/workspace',
      mkdir: (p) => {
        made.push(p);
      },
    });
    expect(r).toEqual({
      ok: true,
      summary: 'fresh を作成し、信頼済みにして Remote Control を起動した',
    });
    expect(made).toEqual(['/Users/t/workspace/fresh']);
    expect(writes).toEqual(['/Users/t/.claude.json']);
    expect(calls.start).toEqual(['fresh']);
  });
});
