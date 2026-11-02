import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Command } from '@macmini/shared';
import type { ActionContext } from '../src/actions/context.js';
import { executeCommand } from '../src/actions/index.js';
import { buildConfig } from '../src/config.js';
import { silentLogger } from '../src/log.js';
import { parseRcSettings, readRcSettings, writeRcSettings } from '../src/rcsettings.js';
import { emptyState } from '../src/state.js';

describe('rc.json（権限モード）', () => {
  it('無い・不正なら bypassPermissions、あれば値を返す', () => {
    expect(parseRcSettings(null).permission_mode).toBe('bypassPermissions');
    expect(parseRcSettings('{bad').permission_mode).toBe('bypassPermissions');
    expect(parseRcSettings('{"permission_mode":"plan"}').permission_mode).toBe('bypassPermissions');
    expect(parseRcSettings('{"permission_mode":"default"}').permission_mode).toBe('default');
  });
});

describe('rc_permission_set', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rcperm-'));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('rc.json を書き、メイン RC を kickstart し、フォルダごとの RC を起動し直す', async () => {
    const cfg = buildConfig({
      env: 'vm1',
      settings: { base_url: 'https://x.example.test', claude_path: '/opt/claude/bin/claude' },
      token: { client_id: 'a', client_secret: 'b' },
      home: '/Users/t',
      uid: 502,
      configDir: dir,
    });
    const runs: string[][] = [];
    const started: string[] = [];
    const stopped: string[] = [];
    const ctx: ActionContext & { saved: number } = {
      cfg,
      run: async (cmd, args) => {
        runs.push([cmd, ...args]);
        return { code: 0, stdout: '', stderr: '', timedOut: false };
      },
      log: silentLogger,
      state: { ...emptyState(), rc_dirs: ['proj'] },
      saved: 0,
      saveState() {
        ctx.saved++;
      },
      now: () => 0,
      sleep: async () => {},
      readRcLogTail: () => '',
      rcDirs: {
        desired: () => ['proj'],
        start: (d: string) => {
          started.push(d);
          return { ok: true, already: false };
        },
        stop: (d: string) => {
          stopped.push(d);
          return { ok: true, wasRunning: true };
        },
      },
    };
    const cmd = (mode: unknown): Command => ({
      id: 'c1',
      env: 'vm1',
      executor: 'vm1',
      action: 'rc_permission_set',
      args: { permission_mode: mode as 'default' },
      status: 'running',
      requested_by: 'k',
      created_at: 0,
      not_before: null,
      expires_at: 1,
      started_at: null,
      finished_at: null,
      output: null,
    });
    const opts = { batch: [], sendResult: async () => true };

    const r = await executeCommand(cmd('default'), ctx, opts);
    expect(r.status).toBe('done');
    expect(readRcSettings(cfg.rcSettingsFile).permission_mode).toBe('default');
    expect(JSON.parse(readFileSync(cfg.rcSettingsFile, 'utf8'))).toEqual({
      permission_mode: 'default',
    });
    expect(runs.some((a) => a[0] === '/bin/launchctl' && a[1] === 'kickstart')).toBe(true);
    expect(stopped).toEqual(['proj']);
    expect(started).toEqual(['proj']);

    // 不正な値は書かない
    const bad = await executeCommand(cmd('plan'), ctx, opts);
    expect(bad.status).toBe('failed');
    expect(readRcSettings(cfg.rcSettingsFile).permission_mode).toBe('default');

    // 戻す
    writeRcSettings(cfg.rcSettingsFile, { permission_mode: 'bypassPermissions' });
    expect(readRcSettings(cfg.rcSettingsFile).permission_mode).toBe('bypassPermissions');
  });
});
