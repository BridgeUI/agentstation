import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isEnv, VM_ENVS, type Env, type VmEnv } from '@macmini/shared';

/**
 * エージェントの設定（docs/spec.md 3.6・9章）。
 *
 * ~/.config/macmini-agent/config.json（例。パスはすべて絶対パス）
 * {
 *   "base_url": "https://workstation.example.com",
 *   "claude_path": "/Users/<user>/.local/bin/claude",
 *   "tart_path": "/opt/homebrew/bin/tart",            // host だけ必須
 *   "codex_app": "/Applications/ChatGPT.app",          // Codex を ChatGPT アプリで動かすとき（任意）
 *   "work_dir": "/Users/<user>/work/rc",               // claude remote-control の作業フォルダ
 *   "rc_debug_log": "/Users/<user>/Library/Logs/claude-rc.log",  // --debug-file のパス
 *   "labels": { "claude_rc": "com.example.claude-rc", "codex": "com.example.codex",
 *               "vm1": "com.example.tart-vm1", "vm2": "com.example.tart-vm2" },
 *   "vm_plists": { "vm1": "/Users/<user>/Library/LaunchAgents/com.example.tart-vm1.plist", ... },
 *   "vm_names": { "vm1": "vm1", "vm2": "vm2" },        // tart 上の VM 名
 *   "vm_ips": { "vm1": "192.168.64.10", "vm2": "192.168.64.11" },  // 固定 IP（あれば tart ip より優先）
 *   "tart_vms_dir": "/Users/<user>/.tart/vms",
 *   "interval_ms": 60000
 * }
 * ~/.config/macmini-agent/token.json（chmod 600）
 * { "client_id": "...", "client_secret": "..." }
 *
 * 設定値（特にトークン）はログや送信データに出さない。
 */
export interface AgentConfig {
  env: Env;
  /** 例: https://workstation.example.com */
  baseUrl: string;
  /** Access サービストークン（環境ごと）。CF-Access-Client-Id / CF-Access-Client-Secret */
  clientId: string;
  clientSecret: string;
  intervalMs: number;
  /** launchctl の gui/<uid> に使う */
  uid: number;
  claudePath: string;
  /** host だけ。VM では使わない */
  tartPath: string | null;
  /**
   * Codex を ChatGPT デスクトップアプリとして動かす場合のアプリの場所（例 /Applications/ChatGPT.app。docs/spec.md 13章 #19）。
   * あればプロセスの有無で状態を取り、codex_restart はアプリを終了して開き直す。無ければ labels.codex（launchd）を見る
   */
  codexApp: string | null;
  workDir: string;
  rcDebugLog: string;
  labels: {
    claudeRc: string;
    /** Codex の常駐が無い環境では null（state は unknown になる） */
    codex: string | null;
    vm: Record<VmEnv, string>;
  };
  vmPlists: Record<VmEnv, string>;
  vmNames: Record<VmEnv, string>;
  /** VM の固定 IP（docs/verify.md B-2 で静的 IP に決めた）。あれば tart ip より優先する。無い VM は tart ip で引く */
  vmIps: Partial<Record<VmEnv, string>>;
  tartVmsDir: string;
  /** session_restore で session_id を起動側に渡すファイル（actions/rc.ts） */
  sessionFile: string;
  /** 最終実行日などを持つ状態ファイル */
  stateFile: string;
  /** Remote Control の起動設定（permission_mode）。claude-rc.sh とフォルダごとの RC が読む */
  rcSettingsFile: string;
  /** Claude Code 全体の設定（~/.claude/settings.json）。claude_permission_set が既定の権限モードだけ書き換える */
  claudeSettingsFile: string;
  /** Claude Code のユーザー状態（~/.claude.json）。起動（rc_start_dir / rc_mkdir）がフォルダの信頼フラグだけ書き換える */
  claudeJsonFile: string;
  /** host_restart が sudo で呼ぶ。sudoers でこの 1 コマンドだけ NOPASSWD */
  shutdownPath: string;
  sudoPath: string;
}

export const CONFIG_DIR = join(homedir(), '.config', 'macmini-agent');

export const DEFAULT_LABELS = {
  claude_rc: 'com.example.claude-rc',
  codex: 'com.example.codex',
  vm1: 'com.example.tart-vm1',
  vm2: 'com.example.tart-vm2',
} as const;

export function parseEnvArg(argv: readonly string[]): Env {
  const envArg = argv.find((a) => a.startsWith('--env='))?.slice('--env='.length);
  if (!isEnv(envArg)) throw new Error('--env=host|vm1|vm2 を指定する');
  return envArg;
}

export function loadConfig(argv: readonly string[]): AgentConfig {
  const env = parseEnvArg(argv);
  const settings = readJson(join(CONFIG_DIR, 'config.json'));
  const tokenPath = join(CONFIG_DIR, 'token.json');
  const token = readJson(tokenPath);
  warnIfReadable(tokenPath);
  const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
  return buildConfig({ env, settings, token, home: homedir(), uid, configDir: CONFIG_DIR });
}

export interface ConfigSources {
  env: Env;
  settings: Record<string, unknown>;
  token: Record<string, unknown>;
  home: string;
  uid: number;
  configDir: string;
}

/** 設定の組み立て（純粋関数。テストはこちらを使う） */
export function buildConfig(s: ConfigSources): AgentConfig {
  const { env, settings, token, home, configDir } = s;
  const labelsRaw = optObj(settings, 'labels') ?? {};
  const plistsRaw = optObj(settings, 'vm_plists') ?? {};
  const namesRaw = optObj(settings, 'vm_names') ?? {};
  const ipsRaw = optObj(settings, 'vm_ips') ?? {};

  const labels = {
    claudeRc: optStr(labelsRaw, 'claude_rc') ?? DEFAULT_LABELS.claude_rc,
    codex: labelsRaw.codex === null ? null : (optStr(labelsRaw, 'codex') ?? DEFAULT_LABELS.codex),
    vm: {} as Record<VmEnv, string>,
  };
  const vmPlists = {} as Record<VmEnv, string>;
  const vmNames = {} as Record<VmEnv, string>;
  const vmIps: Partial<Record<VmEnv, string>> = {};
  for (const vm of VM_ENVS) {
    labels.vm[vm] = optStr(labelsRaw, vm) ?? DEFAULT_LABELS[vm];
    vmPlists[vm] =
      optStr(plistsRaw, vm) ?? join(home, 'Library', 'LaunchAgents', `${labels.vm[vm]}.plist`);
    vmNames[vm] = optStr(namesRaw, vm) ?? vm;
    const ip = optStr(ipsRaw, vm);
    if (ip !== undefined) {
      if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip))
        throw new Error(`設定 vm_ips.${vm} は IPv4 アドレスにする`);
      vmIps[vm] = ip;
    }
  }

  const tartPath = env === 'host' ? absPath(settings, 'tart_path') : null;
  const intervalMs = optNum(settings, 'interval_ms') ?? 60_000;
  if (intervalMs < 10_000) throw new Error('設定 interval_ms は 10000 以上にする');

  return {
    env,
    baseUrl: str(settings, 'base_url').replace(/\/+$/, ''),
    clientId: str(token, 'client_id'),
    clientSecret: str(token, 'client_secret'),
    intervalMs,
    uid: s.uid,
    claudePath: absPath(settings, 'claude_path'),
    tartPath,
    codexApp: optAbsPath(settings, 'codex_app') ?? null,
    workDir: optAbsPath(settings, 'work_dir') ?? join(home, 'work', 'rc'),
    rcDebugLog:
      optAbsPath(settings, 'rc_debug_log') ?? join(home, 'Library', 'Logs', 'claude-rc.log'),
    labels,
    vmPlists,
    vmNames,
    vmIps,
    tartVmsDir: optAbsPath(settings, 'tart_vms_dir') ?? join(home, '.tart', 'vms'),
    sessionFile: join(configDir, 'session.json'),
    stateFile: join(configDir, 'state.json'),
    rcSettingsFile: join(configDir, 'rc.json'),
    claudeSettingsFile: join(home, '.claude', 'settings.json'),
    claudeJsonFile: join(home, '.claude.json'),
    shutdownPath: '/sbin/shutdown',
    sudoPath: '/usr/bin/sudo',
  };
}

function readJson(path: string): Record<string, unknown> {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`設定ファイルの形が不正（${basename(path)}）`);
  }
  return raw as Record<string, unknown>;
}

function basename(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

/** token.json が他人から読めるときは警告だけ出す（値は出さない） */
function warnIfReadable(path: string): void {
  try {
    const mode = statSync(path).mode & 0o077;
    if (mode !== 0) {
      console.warn(`token.json の権限が広い（chmod 600 にする）`);
    }
  } catch {
    /* stat できなければ readJson 側で失敗している */
  }
}

function str(o: Record<string, unknown>, key: string): string {
  const v = o[key];
  if (typeof v !== 'string' || v.length === 0) throw new Error(`設定 ${key} がない`);
  return v;
}

function optStr(o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function optNum(o: Record<string, unknown>, key: string): number | undefined {
  const v = o[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function optObj(o: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const v = o[key];
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function absPath(o: Record<string, unknown>, key: string): string {
  const v = str(o, key);
  if (!v.startsWith('/')) throw new Error(`設定 ${key} は絶対パスにする`);
  return v;
}

function optAbsPath(o: Record<string, unknown>, key: string): string | undefined {
  const v = optStr(o, key);
  if (v === undefined) return undefined;
  if (!v.startsWith('/')) throw new Error(`設定 ${key} は絶対パスにする`);
  return v;
}
