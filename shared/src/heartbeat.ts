import type { Env, Millis, VmEnv } from './env.js';
import type { RcPermissionMode } from './commands.js';
import type { SetupCheck } from './setup.js';

/** docs/spec.md 4.4 */

export type ClaudeProcessState = 'running' | 'stopped' | 'unknown';
export type RemoteControlState = 'connected' | 'reconnecting' | 'login_required' | 'unknown';
export type VmState = 'stopped' | 'starting' | 'running' | 'unknown';

export interface ClaudeStatus {
  state: ClaudeProcessState;
  rc_state: RemoteControlState;
  /** Remote Control の権限モード（rc.json の値。13章 #18）。古いエージェントは送らない */
  rc_permission_mode?: RcPermissionMode;
  version?: string;
  channel?: string;
  last_restart?: Millis;
}

export interface CodexStatus {
  state: ClaudeProcessState;
}

/** 復元用。タイトルは 60 文字まで（docs/spec.md 9章）。 */
export interface SessionInfo {
  id: string;
  title?: string;
  started_at?: Millis;
}

export const SESSION_TITLE_MAX = 60;

export type MaintenanceResult = 'ok' | 'updated' | 'busy' | 'failed' | 'skipped';

export interface MaintenanceStatus {
  last_run_at?: Millis;
  last_result?: MaintenanceResult;
}

interface HeartbeatBase {
  agent_version: string;
  agent_started_at: Millis;
  sent_at: Millis;
  claude: ClaudeStatus;
  codex: CodexStatus;
  sessions: SessionInfo[];
  maintenance?: MaintenanceStatus;
  /** Mac の基礎設定のチェック結果（shared/src/setup.ts）。無ければ未収集 */
  setup?: SetupCheck[];
  /** フォルダを選んで起動する Remote Control（docs/spec.md 13章 #13）。無ければ未対応 */
  rc_dirs?: RcDirs;
}

/** 作業フォルダ直下のフォルダで動かす追加の Remote Control。dir はフォルダ名だけ（パスは送らない） */
export type RcDirState = 'starting' | 'running' | 'stopped' | 'error';
export interface RcDirRunning {
  dir: string;
  state: RcDirState;
  /** claude remote-control --name に渡した名前（アプリに出る名前） */
  name?: string;
  started_at?: Millis;
  /** 短い理由（例: 'not trusted'）。パスは入れない */
  detail?: string;
}
export interface RcDirs {
  /** 作業フォルダの最後の要素（例: 'workspace'） */
  root: string;
  /** 起動できるフォルダ名（作業フォルダ直下、先頭ドット以外、最大 100） */
  available: string[];
  running: RcDirRunning[];
}

/** vm1 / vm2 のエージェントが送る */
export interface VmHeartbeat extends HeartbeatBase {
  env: VmEnv;
  guest: {
    os_version?: string;
    boot_at?: Millis;
    disk_used_gb?: number;
    disk_total_gb?: number;
  };
}

export interface VmView {
  env: VmEnv;
  vm_state: VmState;
  ip?: string;
  usage: { cpu_pct_of_host?: number; mem_gb?: number; disk_image_gb?: number };
  alloc: { cpu?: number; mem_gb?: number; disk_gb?: number };
}

/** host のエージェントが送る */
export interface HostHeartbeat extends HeartbeatBase {
  env: 'host';
  host: {
    os_version?: string;
    tart_version?: string;
    boot_at?: Millis;
    cpu_cores?: number;
    mem_total_gb?: number;
    disk_total_gb?: number;
    cpu_pct?: number;
    mem_used_gb?: number;
    disk_used_gb?: number;
  };
  vms: VmView[];
}

export type Heartbeat = HostHeartbeat | VmHeartbeat;

export function isHostHeartbeat(h: Heartbeat): h is HostHeartbeat {
  return h.env === 'host';
}

/** host 向けの応答に入れる、VM エージェントの直近の報告の要約 */
export interface PeerSummary {
  received_at: Millis;
  maintenance?: MaintenanceStatus;
  busy: boolean;
}

export interface HeartbeatResponse {
  commands: import('./commands.js').Command[];
  /** 次に見に来るまでの間隔（ミリ秒）。画面が見られている・指示が進行中なら短い（api.ts の pollIntervalFor） */
  poll_ms?: number;
  /** host のエージェントにだけ返す */
  peers?: Partial<Record<VmEnv, PeerSummary>>;
}

/** 送ってはいけないものが混ざっていないかの最終チェックに使う（agent 側で送信直前に通す） */
export const FORBIDDEN_PATTERNS: readonly RegExp[] = [
  /\/Users\//, // パス
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, // メールアドレス
  /sk-ant-[A-Za-z0-9_-]+/, // Claude の API キー
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // JWT
];

export function envOf(h: Heartbeat): Env {
  return h.env;
}
