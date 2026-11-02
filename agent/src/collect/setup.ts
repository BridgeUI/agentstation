import { existsSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { homedir, userInfo } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import {
  setupKeysFor,
  type Env,
  type SetupCheck,
  type SetupCheckKey,
  type SetupStatus,
  type VmEnv,
} from '@agentstation/shared';
import { readClaudeDefaultMode } from '../claudesettings.js';
import type { AgentConfig } from '../config.js';
import { runDf, type ExecResult, type Runner } from '../exec.js';

/**
 * Mac の基礎設定のチェック（shared/src/setup.ts のカタログ、docs/spec.md 3.2、mac/scripts/check.sh）。
 * 各判定は外部コマンドの出力文字列を受ける純粋関数（judge*）。収集（collectSetup）はそれらを束ねるだけ。
 * detail にはパス・メール・トークンを入れない（送信直前のフィルタに引っかかると送れない）。
 */

export interface Verdict {
  status: SetupStatus;
  detail?: string;
}

export const SETUP_DETAIL_MAX = 80;

const ok = (detail?: string): Verdict => (detail ? { status: 'ok', detail } : { status: 'ok' });
const ng = (detail: string): Verdict => ({ status: 'ng', detail });
const unknown = (detail: string): Verdict => ({ status: 'unknown', detail });
const skip = (detail: string): Verdict => ({ status: 'skip', detail });

// ---------- 判定（純粋関数） ----------

/** `pmset -g` の `  sleep                0 (...)` の形から値を取る */
export function parsePmset(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s+([A-Za-z][\w-]*)\s+(\S+)/.exec(line);
    if (m && m[1] !== undefined && m[2] !== undefined) out.set(m[1], m[2]);
  }
  return out;
}

export function judgePmset(text: string, key: string, expected: string): Verdict {
  const v = parsePmset(text).get(key);
  if (v === undefined) return skip('not present');
  return v === expected ? ok(`${key}=${v}`) : ng(`${key}=${v}`);
}

export function judgeFileVault(text: string): Verdict {
  if (/FileVault is Off/i.test(text)) return ok();
  if (/FileVault is On/i.test(text)) return ng('on');
  return unknown('unreadable');
}

export function judgeAutoLogin(r: Pick<ExecResult, 'code' | 'stdout'>, username: string): Verdict {
  const v = r.code === 0 ? r.stdout.trim() : '';
  if (!v) return ng('not set');
  return v === username ? ok() : ng('other user');
}

/** `defaults read <domain>` の `{ Key = value; ... }` を読む（文字列の引用符は外す） */
export function parseDefaultsDict(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*"?([\w.-]+)"?\s*=\s*"?([^";]*?)"?\s*;\s*$/.exec(line);
    if (m && m[1] !== undefined && m[2] !== undefined) out.set(m[1], m[2]);
  }
  return out;
}

export const SOFTWARE_UPDATE_KEYS = [
  'AutomaticallyInstallMacOSUpdates',
  'AutomaticDownload',
  'CriticalUpdateInstall',
  'ConfigDataInstall',
] as const;

/** 4 つのキーがすべて 0 なら ok。無いキー・0 でないキーを detail に並べる */
export function judgeSoftwareUpdate(r: Pick<ExecResult, 'code' | 'stdout'>): Verdict {
  if (r.code !== 0) return ng('not set');
  const d = parseDefaultsDict(r.stdout);
  const bad: string[] = [];
  for (const k of SOFTWARE_UPDATE_KEYS) {
    const v = d.get(k);
    if (v === undefined) bad.push(`${k}=missing`);
    else if (v !== '0') bad.push(`${k}=${v}`);
  }
  return bad.length === 0 ? ok() : ng(bad.join(' '));
}

export function judgeAppStoreAuto(r: Pick<ExecResult, 'code' | 'stdout'>): Verdict {
  if (r.code !== 0) return ng('not set');
  const v = r.stdout.trim();
  return v === '0' ? ok() : ng(`AutoUpdate=${v}`);
}

export function judgePort(open: boolean | null, port: number): Verdict {
  if (open === null) return unknown(`port ${port} probe failed`);
  return open ? ok(`port ${port} open`) : ng(`port ${port} closed`);
}

/**
 * ファイル共有（SMB）で `workspace` が公開されているか（shared の sharing.smb_workspace）。
 * - `sharing -l` の出力に name: workspace の共有があり、その smb の guest access が 0
 * - `pwpolicy -u <user> -gethashtypes` に SMB-NT がある（無いと SMB ログインが通らない）
 * - 445 が LISTEN
 * detail は短い理由だけ（パス・ユーザー名は入れない）。
 */
export function judgeSmbWorkspace(
  sharingText: string,
  hashTypesText: string,
  port445: boolean | null,
  shareName = 'workspace',
): Verdict {
  const share = parseSharePoints(sharingText).get(shareName);
  const problems: string[] = [];
  if (!share) problems.push(`${shareName} 共有なし`);
  else if (share.guest) problems.push('ゲスト許可（-g 000 にする）');
  if (!/^\s*SMB-NT\s*$/m.test(hashTypesText)) problems.push('SMB-NT ハッシュなし');
  if (port445 === false) problems.push('port 445 closed');
  if (problems.length > 0) return ng(problems.join('・'));
  if (port445 === null) return unknown('port 445 probe failed');
  return ok(`${shareName} · port 445 open`);
}

/** `sharing -l` の共有ポイント一覧（name → smb の guest access）。path は読まない */
export function parseSharePoints(text: string): Map<string, { guest: boolean }> {
  const out = new Map<string, { guest: boolean }>();
  // 共有ごとに "name:\tX" が 2 回出る（外側と smb ブロック内）。外側の name で区切り、ブロック内の guest access を拾う
  const blocks = text.split(/^name:\s*/m).slice(1);
  for (const b of blocks) {
    const name = b.split(/\r?\n/)[0]?.trim();
    if (!name) continue;
    const g = /guest access:\s*(\d)/.exec(b);
    out.set(name, { guest: g?.[1] === '1' });
  }
  return out;
}

/** `route -n get default` の `interface: en0` */
export function parseDefaultInterface(text: string): string | undefined {
  return /^\s*interface:\s*(\S+)/m.exec(text)?.[1];
}

/** `networksetup -listallhardwareports` → Device → Hardware Port */
export function parseHardwarePorts(text: string): Map<string, string> {
  const out = new Map<string, string>();
  let port: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const p = /^Hardware Port:\s*(.+)$/.exec(line);
    if (p) {
      port = p[1]?.trim();
      continue;
    }
    const d = /^Device:\s*(\S+)/.exec(line);
    if (d && d[1] !== undefined && port !== undefined) out.set(d[1], port);
  }
  return out;
}

export function judgeEthernet(routeText: string, hwPortsText: string): Verdict {
  const iface = parseDefaultInterface(routeText);
  if (!iface) return unknown('no default route');
  const port = parseHardwarePorts(hwPortsText).get(iface);
  if (!port) return unknown(`${iface}: unknown port`);
  if (/wi-?fi|airport/i.test(port)) return ng(`${iface}: Wi-Fi`);
  if (/ethernet|lan|thunderbolt/i.test(port)) return ok(`${iface}: ${port}`);
  return unknown(`${iface}: ${port}`);
}

/** `readlink /etc/localtime` → `/var/db/timezone/zoneinfo/Asia/Tokyo` */
export function judgeTimezone(text: string): Verdict {
  const t = text.trim();
  if (!t) return unknown('unreadable');
  if (t.includes('Asia/Tokyo')) return ok();
  const zone = /zoneinfo\/(.+)$/.exec(t)?.[1] ?? 'other';
  return ng(zone);
}

/** `claude auth status` の JSON の loggedIn。メールなど他のフィールドは使わない */
export function judgeClaudeAuth(r: Pick<ExecResult, 'code' | 'stdout'>): Verdict {
  let parsed: unknown;
  try {
    const start = r.stdout.indexOf('{');
    parsed = JSON.parse(start >= 0 ? r.stdout.slice(start) : r.stdout);
  } catch {
    return unknown(r.code === 0 ? 'unreadable' : `exit ${r.code}`);
  }
  if (typeof parsed !== 'object' || parsed === null) return unknown('unreadable');
  const v = (parsed as Record<string, unknown>).loggedIn;
  if (v === true) return ok();
  if (v === false) return ng('not logged in');
  return unknown('no loggedIn field');
}

/** ~/.claude/settings.json の env.DISABLE_AUTOUPDATER === "1" */
export function judgeAutoupdaterOff(settingsText: string | null): Verdict {
  if (settingsText === null) return ng('no settings.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(settingsText);
  } catch {
    return unknown('invalid json');
  }
  const env = (parsed as { env?: unknown } | null)?.env;
  const v =
    typeof env === 'object' && env !== null
      ? (env as Record<string, unknown>).DISABLE_AUTOUPDATER
      : undefined;
  return v === '1' || v === 1 ? ok() : ng('DISABLE_AUTOUPDATER not 1');
}

/** ~/.claude/settings.json の permissions.defaultMode が bypassPermissions で、確認ダイアログも省く設定（13章 #20） */
export function judgeDefaultBypass(settingsText: string | null): Verdict {
  const m = readClaudeDefaultMode(settingsText);
  if (m.readable === 'missing') return ng('no settings.json');
  if (m.readable === 'invalid') return unknown('invalid json');
  if (m.defaultMode !== 'bypassPermissions') return ng(`defaultMode=${m.defaultMode ?? 'unset'}`);
  if (!m.skipPrompt) return ng('skipDangerousModePermissionPrompt not true');
  return ok('bypassPermissions');
}

/** 作業フォルダがホームそのもの・Desktop・Documents・Downloads（TCC 保護）でなく存在する。detail は最後の要素だけ。~/workspace は可（13章 #15） */
export function judgeWorkdir(workDir: string, home: string, exists: boolean): Verdict {
  const dir = resolve(workDir);
  const h = resolve(home);
  const name = basename(dir);
  if (dir === h) return ng('is home');
  for (const bad of ['Desktop', 'Documents', 'Downloads']) {
    const p = join(h, bad);
    if (dir === p || dir.startsWith(p + '/')) return ng(`${name}: under ${bad}`);
  }
  if (!exists) return ng(`${name}: missing`);
  return ok(name);
}

/** launchctl print の結果。読めなければ not loaded */
export function judgeLaunchd(r: Pick<ExecResult, 'code' | 'stdout' | 'stderr'>): Verdict {
  if (r.code !== 0) return ng('not loaded');
  const state = /^\s*state\s*=\s*(\S+)/m.exec(r.stdout)?.[1];
  if (state === undefined) return unknown('no state');
  return state === 'running' ? ok() : ng(`state=${state}`);
}

/** `pgrep -x cloudflared`：0 ならあり、1 なら無し */
export function judgePgrep(r: Pick<ExecResult, 'code'>): Verdict {
  if (r.code === 0) return ok();
  if (r.code === 1) return ng('no process');
  return unknown(`exit ${r.code}`);
}

/** `sudo -n -l /sbin/shutdown -r now`：実行はしない */
export function judgeSudoers(r: Pick<ExecResult, 'code'>): Verdict {
  return r.code === 0 ? ok() : ng('not allowed');
}

/** `tmutil isexcluded <dir>` → `[Excluded] <dir>` */
export function judgeTmutil(r: Pick<ExecResult, 'code' | 'stdout'>): Verdict {
  if (r.code !== 0) return unknown(`exit ${r.code}`);
  if (/\[Excluded\]/.test(r.stdout)) return ok();
  if (/\[Included\]/.test(r.stdout)) return ng('not excluded');
  return unknown('unreadable');
}

export const DISK_FREE_MIN_PCT = 15;

/** `df -k /System/Volumes/Data` の Available / 1024-blocks が 15% 以上 */
export function judgeDiskFree(text: string): Verdict {
  const row = text
    .trim()
    .split(/\r?\n/)
    .find((l, i) => i > 0 && /^\S+\s+\d+\s+\d+\s+\d+/.test(l));
  if (!row) return unknown('unreadable');
  const cols = row.trim().split(/\s+/);
  const blocks = Number(cols[1]);
  const avail = Number(cols[3]);
  if (!(blocks > 0) || !Number.isFinite(avail)) return unknown('unreadable');
  const pct = Math.round((avail / blocks) * 100);
  return pct >= DISK_FREE_MIN_PCT ? ok(`free ${pct}%`) : ng(`free ${pct}%`);
}

/** ユーザー名の一致はサーバー側で判定する（メールはエージェントが知らない） */
export function judgeUserName(username: string): Verdict {
  return unknown(username);
}

// ---------- 収集 ----------

/** 外部コマンド以外の材料。テストで差し替える */
export interface SetupDeps {
  probePort: (port: number) => Promise<boolean | null>;
  readText: (path: string) => string | null;
  exists: (path: string) => boolean;
  username: () => string;
  home: () => string;
}

export const realSetupDeps: SetupDeps = {
  probePort: (port) => probeTcp('127.0.0.1', port, 2000),
  readText: (path) => {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  },
  exists: (path) => existsSync(path),
  username: () => userInfo().username,
  home: () => homedir(),
};

function probeTcp(host: string, port: number, timeoutMs: number): Promise<boolean | null> {
  return new Promise((resolve) => {
    const sock = connect({ host, port });
    const done = (v: boolean | null): void => {
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', (e: NodeJS.ErrnoException) =>
      done(e.code === 'ECONNREFUSED' || e.code === 'ETIMEDOUT' ? false : null),
    );
  });
}

export async function collectSetup(
  env: Env,
  cfg: AgentConfig,
  run: Runner,
  deps: SetupDeps = realSetupDeps,
): Promise<SetupCheck[]> {
  // 使っていない VM の自動起動（launchd.vm1 / vm2）は確かめない
  const keys = setupKeysFor(env).filter(
    (k) => !(k === 'launchd.vm1' || k === 'launchd.vm2') || cfg.vms.includes(k.slice(8) as VmEnv),
  );
  const want = new Set<SetupCheckKey>(keys);
  const home = deps.home();
  const username = deps.username();
  const results = new Map<SetupCheckKey, Verdict>();

  const needPmset = keys.some((k) => k.startsWith('power.'));
  const pmset = needPmset ? await run('/usr/bin/pmset', ['-g']) : null;
  const pm = (key: string, expected: string): Verdict =>
    pmset && pmset.code === 0 ? judgePmset(pmset.stdout, key, expected) : unknown('pmset failed');
  if (want.has('power.sleep')) results.set('power.sleep', pm('sleep', '0'));
  if (want.has('power.disksleep')) results.set('power.disksleep', pm('disksleep', '0'));
  if (want.has('power.autorestartatconnect'))
    results.set('power.autorestartatconnect', pm('autorestartatconnect', '1'));
  if (want.has('power.powernap')) results.set('power.powernap', pm('powernap', '0'));

  if (want.has('security.filevault')) {
    const r = await run('/usr/bin/fdesetup', ['status']);
    results.set(
      'security.filevault',
      r.code === 0 ? judgeFileVault(r.stdout) : unknown('fdesetup failed'),
    );
  }
  if (want.has('login.autologin')) {
    const r = await run('/usr/bin/defaults', [
      'read',
      '/Library/Preferences/com.apple.loginwindow',
      'autoLoginUser',
    ]);
    results.set('login.autologin', judgeAutoLogin(r, username));
  }
  if (want.has('update.macos_auto_install')) {
    const r = await run('/usr/bin/defaults', [
      'read',
      '/Library/Preferences/com.apple.SoftwareUpdate',
    ]);
    results.set('update.macos_auto_install', judgeSoftwareUpdate(r));
  }
  if (want.has('update.appstore_auto')) {
    const r = await run('/usr/bin/defaults', [
      'read',
      '/Library/Preferences/com.apple.commerce',
      'AutoUpdate',
    ]);
    results.set('update.appstore_auto', judgeAppStoreAuto(r));
  }
  if (want.has('sharing.ssh')) results.set('sharing.ssh', judgePort(await deps.probePort(22), 22));
  if (want.has('sharing.vnc'))
    results.set('sharing.vnc', judgePort(await deps.probePort(5900), 5900));
  if (want.has('sharing.smb_workspace')) {
    const [sh, hashes, p445] = await Promise.all([
      run('/usr/sbin/sharing', ['-l']),
      run('/usr/bin/pwpolicy', ['-u', username, '-gethashtypes']),
      deps.probePort(445),
    ]);
    results.set(
      'sharing.smb_workspace',
      sh.code === 0
        ? judgeSmbWorkspace(sh.stdout, hashes.code === 0 ? hashes.stdout : '', p445)
        : unknown('sharing -l failed'),
    );
  }
  if (want.has('network.ethernet')) {
    const [route, ports] = await Promise.all([
      run('/sbin/route', ['-n', 'get', 'default']),
      run('/usr/sbin/networksetup', ['-listallhardwareports']),
    ]);
    results.set(
      'network.ethernet',
      route.code === 0 && ports.code === 0
        ? judgeEthernet(route.stdout, ports.stdout)
        : unknown('command failed'),
    );
  }
  if (want.has('system.timezone')) {
    const r = await run('/usr/bin/readlink', ['/etc/localtime']);
    results.set('system.timezone', r.code === 0 ? judgeTimezone(r.stdout) : unknown('unreadable'));
  }
  if (want.has('claude.logged_in')) {
    const r = await run(cfg.claudePath, ['auth', 'status'], {
      timeoutMs: 20_000,
      cwd: cfg.workDir,
    });
    results.set('claude.logged_in', judgeClaudeAuth(r));
  }
  if (want.has('claude.autoupdater_off')) {
    results.set(
      'claude.autoupdater_off',
      judgeAutoupdaterOff(deps.readText(join(home, '.claude', 'settings.json'))),
    );
  }
  if (want.has('claude.default_bypass')) {
    results.set(
      'claude.default_bypass',
      judgeDefaultBypass(deps.readText(join(home, '.claude', 'settings.json'))),
    );
  }
  if (want.has('claude.workdir')) {
    results.set('claude.workdir', judgeWorkdir(cfg.workDir, home, deps.exists(cfg.workDir)));
  }

  const launchd = async (label: string): Promise<Verdict> =>
    judgeLaunchd(
      await run('/bin/launchctl', ['print', `gui/${cfg.uid}/${label}`], { timeoutMs: 15_000 }),
    );
  if (want.has('launchd.claude_rc'))
    results.set('launchd.claude_rc', await launchd(cfg.labels.claudeRc));
  if (want.has('launchd.codex')) {
    results.set(
      'launchd.codex',
      cfg.codexApp !== null
        ? await codexAppRunning(cfg.codexApp, run)
        : cfg.labels.codex === null
          ? skip('not configured')
          : await launchd(cfg.labels.codex),
    );
  }
  if (want.has('launchd.vm1')) results.set('launchd.vm1', await launchd(cfg.labels.vm.vm1));
  if (want.has('launchd.vm2')) results.set('launchd.vm2', await launchd(cfg.labels.vm.vm2));

  if (want.has('cloudflared.running')) {
    results.set(
      'cloudflared.running',
      judgePgrep(await run('/usr/bin/pgrep', ['-x', 'cloudflared'])),
    );
  }
  if (want.has('sudoers.shutdown')) {
    results.set(
      'sudoers.shutdown',
      judgeSudoers(await run(cfg.sudoPath, ['-n', '-l', cfg.shutdownPath, '-r', 'now'])),
    );
  }
  if (want.has('timemachine.tart_excluded')) {
    results.set(
      'timemachine.tart_excluded',
      judgeTmutil(await run('/usr/bin/tmutil', ['isexcluded', dirname(cfg.tartVmsDir)])),
    );
  }
  if (want.has('disk.free')) {
    const r = await runDf(run);
    results.set('disk.free', r.code === 0 ? judgeDiskFree(r.stdout) : unknown('df failed'));
  }
  if (want.has('user.name')) results.set('user.name', judgeUserName(username));

  return keys.map((key) => toCheck(key, results.get(key) ?? unknown('not collected')));
}

export function toCheck(key: SetupCheckKey, v: Verdict): SetupCheck {
  const c: SetupCheck = { key, status: v.status };
  if (v.detail) c.detail = [...v.detail].slice(0, SETUP_DETAIL_MAX).join('');
  return c;
}

/**
 * Codex を ChatGPT アプリで動かすとき：アプリが起動しているか（プロセスの有無）。
 * ログイン項目の確認は osascript が launchd 配下では Automation の許可が無く読めない（実機で unknown になった）ので、起動の有無で見る。
 */
export async function codexAppRunning(app: string, run: Runner): Promise<Verdict> {
  const name =
    app
      .replace(/\/$/, '')
      .split('/')
      .pop()
      ?.replace(/\.app$/, '') ?? '';
  const r = await run('/usr/bin/pgrep', ['-f', `${app}/Contents/MacOS/`], { timeoutMs: 20_000 });
  if (r.code === 0) return ok(`${name} running`);
  if (r.code === 1) return ng(`${name} not running（ログイン項目に入れて開いておく）`);
  return unknown('pgrep failed');
}
