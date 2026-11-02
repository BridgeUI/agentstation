import { describe, expect, it } from 'vitest';
import type { ActionContext } from '../src/actions/context.js';
import { codexRestart } from '../src/actions/codex.js';
import { collectCodex } from '../src/collect/claude.js';
import { codexAppRunning } from '../src/collect/setup.js';
import { buildConfig } from '../src/config.js';
import type { ExecResult } from '../src/exec.js';
import { silentLogger } from '../src/log.js';
import { emptyState } from '../src/state.js';

const r = (code: number, stdout = ''): ExecResult => ({
  code,
  stdout,
  stderr: '',
  timedOut: false,
});

function cfgWith(codexApp?: string) {
  return buildConfig({
    env: 'host',
    settings: {
      base_url: 'https://x.example.test',
      claude_path: '/opt/claude/bin/claude',
      tart_path: '/opt/homebrew/bin/tart',
      ...(codexApp ? { codex_app: codexApp } : {}),
    },
    token: { client_id: 'a', client_secret: 'b' },
    home: '/Users/t',
    uid: 501,
    configDir: '/Users/t/.config/agentstation',
  });
}

describe('Codex を ChatGPT アプリで動かす（codex_app）', () => {
  it('config: codex_app は絶対パス。無ければ null', () => {
    expect(cfgWith().codexApp).toBeNull();
    expect(cfgWith('/Applications/ChatGPT.app').codexApp).toBe('/Applications/ChatGPT.app');
    expect(() => cfgWith('ChatGPT.app')).toThrow();
  });

  it('状態：アプリのプロセスがあれば running、無ければ stopped。codex_app が無ければ unknown', async () => {
    const cfg = cfgWith('/Applications/ChatGPT.app');
    const calls: string[][] = [];
    const runUp = async (cmd: string, args: readonly string[]) => {
      calls.push([cmd, ...args]);
      return r(0, '123\n');
    };
    expect(await collectCodex(runUp, cfg)).toEqual({ state: 'running' });
    expect(calls[0]).toEqual(['/usr/bin/pgrep', '-f', '/Applications/ChatGPT.app/Contents/MacOS/']);
    expect(await collectCodex(async () => r(1), cfg)).toEqual({ state: 'stopped' });
    expect(await collectCodex(async () => r(0, '1'), cfgWith())).toEqual({ state: 'unknown' });
  });

  it('再起動：quit → 終了を待つ → open -a → 起動を確認。シェルは使わない', async () => {
    const cfg = cfgWith('/Applications/ChatGPT.app');
    const calls: string[][] = [];
    let opened = false;
    let quitAt = -1;
    let ticks = 0;
    const ctx: ActionContext = {
      cfg,
      run: async (cmd, args) => {
        calls.push([cmd, ...args]);
        if (cmd === '/usr/bin/osascript') quitAt = ticks;
        if (cmd === '/usr/bin/open') opened = true;
        if (cmd === '/usr/bin/pgrep') {
          // quit から 2 秒は生きていて、その後消える。open 後は 1 秒で起動
          if (opened) return r(ticks >= quitAt + 4 ? 0 : 1);
          return r(quitAt >= 0 && ticks >= quitAt + 2 ? 1 : 0);
        }
        return r(0);
      },
      log: silentLogger,
      state: emptyState(),
      saveState() {},
      now: () => 0,
      sleep: async () => {
        ticks++;
      },
      readRcLogTail: () => '',
    };
    const out = await codexRestart(ctx);
    expect(out).toEqual({ ok: true, summary: 'ChatGPT アプリを開き直した' });
    expect(calls.filter((c) => c[0] === '/usr/bin/osascript')).toEqual([
      ['/usr/bin/osascript', '-e', 'tell application "ChatGPT" to quit'],
    ]);
    expect(calls.filter((c) => c[0] === '/usr/bin/open')).toEqual([
      ['/usr/bin/open', '-a', '/Applications/ChatGPT.app'],
    ]);
    // open は quit が終わってから
    const quitIdx = calls.findIndex((c) => c[0] === '/usr/bin/osascript');
    const openIdx = calls.findIndex((c) => c[0] === '/usr/bin/open');
    expect(openIdx).toBeGreaterThan(quitIdx + 1);
  });

  it('基礎設定：アプリのプロセスがあれば ok、無ければ ng、pgrep が失敗なら unknown', async () => {
    const app = '/Applications/ChatGPT.app';
    expect((await codexAppRunning(app, async () => r(0, '12\n'))).status).toBe('ok');
    expect((await codexAppRunning(app, async () => r(1))).status).toBe('ng');
    expect((await codexAppRunning(app, async () => r(2))).status).toBe('unknown');
  });
});
