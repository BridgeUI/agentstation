import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Command } from '@macmini/shared';
import type { ActionContext } from '../src/actions/context.js';
import { executeCommand } from '../src/actions/index.js';
import { applyClaudePermissionMode, writeClaudeSettings } from '../src/claudesettings.js';
import { judgeDefaultBypass } from '../src/collect/setup.js';
import { buildConfig } from '../src/config.js';
import { silentLogger } from '../src/log.js';
import { emptyState } from '../src/state.js';

describe('applyClaudePermissionMode', () => {
  it('無ければ作る。bypass なら確認ダイアログも省く', () => {
    const r = applyClaudePermissionMode(null, 'bypassPermissions');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(JSON.parse(r.text)).toEqual({
      permissions: { defaultMode: 'bypassPermissions' },
      skipDangerousModePermissionPrompt: true,
    });
  });

  it('ほかのキー（env・permissions.allow など）は残す', () => {
    const before = JSON.stringify({
      env: { DISABLE_AUTOUPDATER: '1' },
      theme: 'dark',
      permissions: { allow: ['Bash(git *)'], defaultMode: 'default' },
    });
    const r = applyClaudePermissionMode(before, 'bypassPermissions');
    if (!r.ok) throw new Error(r.reason);
    expect(JSON.parse(r.text)).toEqual({
      env: { DISABLE_AUTOUPDATER: '1' },
      theme: 'dark',
      permissions: { allow: ['Bash(git *)'], defaultMode: 'bypassPermissions' },
      skipDangerousModePermissionPrompt: true,
    });
  });

  it('default に戻すときは defaultMode だけ変える', () => {
    const before = JSON.stringify({
      permissions: { defaultMode: 'bypassPermissions' },
      skipDangerousModePermissionPrompt: true,
    });
    const r = applyClaudePermissionMode(before, 'default');
    if (!r.ok) throw new Error(r.reason);
    expect(JSON.parse(r.text)).toEqual({
      permissions: { defaultMode: 'default' },
      skipDangerousModePermissionPrompt: true,
    });
  });

  it('壊れた JSON・形が違うものは書き換えない', () => {
    expect(applyClaudePermissionMode('{bad', 'bypassPermissions').ok).toBe(false);
    expect(applyClaudePermissionMode('[1]', 'bypassPermissions').ok).toBe(false);
    expect(applyClaudePermissionMode('{"permissions":"x"}', 'bypassPermissions').ok).toBe(false);
  });
});

describe('judgeDefaultBypass', () => {
  it('bypass と確認ダイアログ省略の両方で ok', () => {
    expect(
      judgeDefaultBypass(
        '{"permissions":{"defaultMode":"bypassPermissions"},"skipDangerousModePermissionPrompt":true}',
      ).status,
    ).toBe('ok');
    expect(judgeDefaultBypass('{"permissions":{"defaultMode":"bypassPermissions"}}')).toEqual({
      status: 'ng',
      detail: 'skipDangerousModePermissionPrompt not true',
    });
    expect(judgeDefaultBypass('{"permissions":{"defaultMode":"default"}}')).toEqual({
      status: 'ng',
      detail: 'defaultMode=default',
    });
    expect(judgeDefaultBypass('{}')).toEqual({ status: 'ng', detail: 'defaultMode=unset' });
    expect(judgeDefaultBypass(null).status).toBe('ng');
    expect(judgeDefaultBypass('{bad').status).toBe('unknown');
  });
});

describe('writeClaudeSettings', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'claudeset-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('既存のパーミッションを引き継ぎ、シンボリックリンクなら実体を書き換える', () => {
    const real = join(dir, 'dotfiles', 'settings.json');
    mkdirSync(join(dir, 'dotfiles'));
    writeFileSync(real, '{}', { mode: 0o644 });
    const link = join(dir, 'settings.json');
    symlinkSync(real, link);
    writeClaudeSettings(link, '{"a":1}\n');
    expect(readFileSync(real, 'utf8')).toBe('{"a":1}\n');
    expect(statSync(real).mode & 0o777).toBe(0o644);
  });
});

describe('claude_permission_set', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'claudeperm-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const cmd = (mode: unknown): Command => ({
    id: 'c1',
    env: 'vm1',
    executor: 'vm1',
    action: 'claude_permission_set',
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

  it('~/.claude/settings.json を書き換え、RC は立て直さない', async () => {
    const home = join(dir, 'home');
    const cfg = buildConfig({
      env: 'vm1',
      settings: { base_url: 'https://x.example.test', claude_path: '/opt/claude/bin/claude' },
      token: { client_id: 'a', client_secret: 'b' },
      home,
      uid: 502,
      configDir: join(dir, 'cfg'),
    });
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(cfg.claudeSettingsFile, '{"env":{"DISABLE_AUTOUPDATER":"1"}}');
    const runs: string[][] = [];
    const ctx: ActionContext = {
      cfg,
      run: async (c, args) => {
        runs.push([c, ...args]);
        return { code: 0, stdout: '', stderr: '', timedOut: false };
      },
      log: silentLogger,
      state: emptyState(),
      saveState() {},
      now: () => 0,
      sleep: async () => {},
      readRcLogTail: () => '',
    };
    const opts = { batch: [], sendResult: async () => true };

    const r = await executeCommand(cmd('bypassPermissions'), ctx, opts);
    expect(r.status).toBe('done');
    expect(r.output).not.toContain(home);
    expect(JSON.parse(readFileSync(cfg.claudeSettingsFile, 'utf8'))).toEqual({
      env: { DISABLE_AUTOUPDATER: '1' },
      permissions: { defaultMode: 'bypassPermissions' },
      skipDangerousModePermissionPrompt: true,
    });
    expect(runs).toEqual([]);

    // 不正な値は書かない
    const bad = await executeCommand(cmd('plan'), ctx, opts);
    expect(bad.status).toBe('failed');

    // 壊れた JSON は書き換えずに失敗
    writeFileSync(cfg.claudeSettingsFile, '{bad');
    const broken = await executeCommand(cmd('bypassPermissions'), ctx, opts);
    expect(broken.status).toBe('failed');
    expect(readFileSync(cfg.claudeSettingsFile, 'utf8')).toBe('{bad');
  });
});
