import type { Env } from './env.js';

/**
 * 操作のホワイトリスト（docs/spec.md 6章）。
 * ここに無い action はサーバーが 400 で拒否し、エージェントも実行しない。
 * 任意のシェルコマンドを受け付ける経路は作らない。
 */
export const COMMAND_ACTIONS = [
  'rc_restart',
  'session_restore',
  'rc_start_dir',
  'rc_stop_dir',
  'rc_mkdir',
  'rc_permission_set',
  'claude_permission_set',
  'claude_update',
  'codex_restart',
  'vm_restart',
  'vm_stop',
  'vm_start',
  'host_restart',
  'host_power_cycle',
] as const;
export type CommandAction = (typeof COMMAND_ACTIONS)[number];

/**
 * 指示の実行者。エージェント（host/vm1/vm2）か、Worker 自身（'cloud'。SwitchBot のクラウド API を呼ぶ）。
 * 'cloud' の指示はエージェントには渡らない（docs/spec.md 6.1）。
 */
export const CLOUD_EXECUTOR = 'cloud' as const;
export type Executor = Env | typeof CLOUD_EXECUTOR;

export function isCommandAction(x: unknown): x is CommandAction {
  return typeof x === 'string' && (COMMAND_ACTIONS as readonly string[]).includes(x);
}

export const COMMAND_STATUSES = [
  'queued',
  'running',
  'done',
  'failed',
  'expired',
  'canceled',
] as const;
export type CommandStatus = (typeof COMMAND_STATUSES)[number];

export interface CommandSpec {
  /** 対象にできる環境 */
  targets: readonly Env[];
  /** 実行者。'self' は対象の環境のエージェント、'host' はホストのエージェント、'cloud' は Worker（エージェントを経由しない） */
  executor: 'self' | 'host' | typeof CLOUD_EXECUTOR;
  /** 画面での確認回数。2 はホスト名の手入力を伴う */
  confirm: 1 | 2;
  /** オーナーだけが押せるか */
  ownerOnly: boolean;
  /** queued のまま放置されたときの期限（ミリ秒） */
  ttlMs: number;
  /** 押してから実行までの取り消し猶予（ミリ秒）。ホスト再起動だけ */
  graceMs?: number;
}

const TEN_MIN = 10 * 60 * 1000;

export const COMMAND_SPECS: Record<CommandAction, CommandSpec> = {
  rc_restart: {
    targets: ['host', 'vm1', 'vm2'],
    executor: 'self',
    confirm: 1,
    ownerOnly: false,
    ttlMs: TEN_MIN,
  },
  session_restore: {
    targets: ['host', 'vm1', 'vm2'],
    executor: 'self',
    confirm: 1,
    ownerOnly: false,
    ttlMs: TEN_MIN,
  },
  rc_start_dir: {
    targets: ['host', 'vm1', 'vm2'],
    executor: 'self',
    confirm: 1,
    ownerOnly: false,
    ttlMs: TEN_MIN,
  },
  rc_stop_dir: {
    targets: ['host', 'vm1', 'vm2'],
    executor: 'self',
    confirm: 1,
    ownerOnly: false,
    ttlMs: TEN_MIN,
  },
  rc_mkdir: {
    targets: ['host', 'vm1', 'vm2'],
    executor: 'self',
    confirm: 1,
    ownerOnly: false,
    ttlMs: TEN_MIN,
  },
  rc_permission_set: {
    targets: ['host', 'vm1', 'vm2'],
    executor: 'self',
    confirm: 1,
    ownerOnly: false,
    ttlMs: TEN_MIN,
  },
  claude_permission_set: {
    targets: ['host', 'vm1', 'vm2'],
    executor: 'self',
    confirm: 1,
    ownerOnly: false,
    ttlMs: TEN_MIN,
  },
  claude_update: {
    targets: ['host', 'vm1', 'vm2'],
    executor: 'self',
    confirm: 1,
    ownerOnly: false,
    ttlMs: TEN_MIN,
  },
  codex_restart: {
    targets: ['host', 'vm1', 'vm2'],
    executor: 'self',
    confirm: 1,
    ownerOnly: false,
    ttlMs: TEN_MIN,
  },
  vm_restart: {
    targets: ['vm1', 'vm2'],
    executor: 'host',
    confirm: 1,
    ownerOnly: false,
    ttlMs: TEN_MIN,
  },
  vm_stop: {
    targets: ['vm1', 'vm2'],
    executor: 'host',
    confirm: 1,
    ownerOnly: false,
    ttlMs: TEN_MIN,
  },
  vm_start: {
    targets: ['vm1', 'vm2'],
    executor: 'host',
    confirm: 1,
    ownerOnly: false,
    ttlMs: TEN_MIN,
  },
  host_restart: {
    targets: ['host'],
    executor: 'host',
    confirm: 2,
    ownerOnly: true,
    ttlMs: TEN_MIN,
    graceMs: 60 * 1000,
  },
  // スマートプラグで Mac mini の電源を切って入れる（docs/spec.md 6.1）。Worker が SwitchBot のクラウドを呼ぶ。
  // host の報告が 10 分以上途絶えているときだけ受け付ける（サーバーで判定）
  host_power_cycle: {
    targets: ['host'],
    executor: CLOUD_EXECUTOR,
    confirm: 2,
    ownerOnly: true,
    ttlMs: TEN_MIN,
    graceMs: 60 * 1000,
  },
};

/** 指示の実行者を決める（docs/spec.md 4.1）。 */
export function executorFor(action: CommandAction, env: Env): Executor {
  const ex = COMMAND_SPECS[action].executor;
  if (ex === 'host') return 'host';
  if (ex === CLOUD_EXECUTOR) return CLOUD_EXECUTOR;
  return env;
}

/** 登録から 15 分を過ぎた古い指示では実行しない action（再起動・電源断のループを防ぐ） */
export const WINDOWED_ACTIONS: readonly CommandAction[] = ['host_restart', 'host_power_cycle'];

/** Remote Control の権限モード（docs/spec.md 13章 #18）。既定は bypassPermissions（この Mac は Claude 専用） */
export const RC_PERMISSION_MODES = ['bypassPermissions', 'default'] as const;
export type RcPermissionMode = (typeof RC_PERMISSION_MODES)[number];
export const RC_PERMISSION_MODE_DEFAULT: RcPermissionMode = 'bypassPermissions';
export function isRcPermissionMode(x: unknown): x is RcPermissionMode {
  return typeof x === 'string' && (RC_PERMISSION_MODES as readonly string[]).includes(x);
}

/**
 * 指示の引数。action ごとに形が決まる。これ以外のキーは捨てる。
 * start は rc_mkdir で「作成後に RC を起動」、permission_mode は rc_permission_set / claude_permission_set の値
 */
export type CommandArgs = {
  session_id?: string;
  dir?: string;
  start?: boolean;
  permission_mode?: RcPermissionMode;
};

/** rc_start_dir / rc_stop_dir / rc_mkdir の dir。作業フォルダ直下のフォルダ名だけ（パス区切り・先頭ドット不可） */
export const RC_DIR_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$/;
export function isRcDirName(x: unknown): x is string {
  return typeof x === 'string' && RC_DIR_NAME_RE.test(x) && x !== '.' && x !== '..';
}

export interface Command {
  id: string;
  env: Env;
  executor: Executor;
  action: CommandAction;
  args: CommandArgs | null;
  status: CommandStatus;
  requested_by: string;
  created_at: number;
  not_before: number | null;
  expires_at: number;
  started_at: number | null;
  finished_at: number | null;
  output: string | null;
}

/** エージェントが返す実行結果 */
export interface CommandResult {
  id: string;
  status: 'done' | 'failed';
  /** 要約だけ。ログ本文・パス・秘密情報は入れない */
  output?: string;
}
