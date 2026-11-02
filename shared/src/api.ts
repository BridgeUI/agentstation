import type { Command } from './commands.js';
import type { Env, Millis } from './env.js';
import type { Heartbeat, VmView } from './heartbeat.js';
import type { Identity } from './members.js';
import type { SiteView } from './site.js';

/** GET /api/me */
export type MeResponse = Identity & { site: SiteView };

export type Liveness = 'ok' | 'delayed' | 'unresponsive' | 'unknown';

/** docs/spec.md 5章の判定しきい値 */
export const LIVENESS_DELAYED_MS = 3 * 60 * 1000;
export const LIVENESS_UNRESPONSIVE_MS = 10 * 60 * 1000;

/**
 * エージェントが Worker を見に来る間隔（docs/spec.md 3.6）。Mac からは外向きだけなので、速さは polling の間隔で決まる。
 * ふだんは 60 秒。画面が見られている（直近 90 秒に /api/status が呼ばれた）か、そのエージェント宛の指示が
 * 進行中なら 5 秒。画面側も表示中は 5 秒ごとに取り直す（非表示のタブは 60 秒）。
 */
export const POLL_IDLE_MS = 60 * 1000;
export const POLL_FAST_MS = 5 * 1000;
export const VIEW_ACTIVE_WINDOW_MS = 90 * 1000;
export function pollIntervalFor(a: {
  hasActive: boolean;
  lastViewAt: Millis | null;
  now: Millis;
}): number {
  if (a.hasActive) return POLL_FAST_MS;
  if (a.lastViewAt !== null && a.now - a.lastViewAt < VIEW_ACTIVE_WINDOW_MS) return POLL_FAST_MS;
  return POLL_IDLE_MS;
}

/** GET /api/status の各環境 */
export interface EnvStatus {
  env: Env;
  /** その環境のエージェント自身の最終受信 */
  agent_received_at: Millis | null;
  /** host の報告とその環境のエージェントの報告を合わせた判定（docs/spec.md 5章） */
  liveness: Liveness;
  /** その環境のエージェントが送った内容（sessions は含まない） */
  heartbeat: Heartbeat | null;
  /** VM の場合、host のエージェントから見た状態・使用量 */
  vm_view: VmView | null;
  /** queued / running の指示（同じ環境には同時に1件） */
  active: Command | null;
}

export interface StatusAlert {
  level: 'warn' | 'error';
  message: string;
}

/**
 * Mac の電源ケーブルに挟んだスマートプラグの直近の状態（docs/spec.md 6.1）。
 * Cron が 1 分ごとに SwitchBot のクラウド API から取り、D1 の plug_status に置く。エージェントは関与しない。
 */
export type PlugPower = 'on' | 'off' | 'unknown';
export interface PlugView {
  /** 取得した時刻（サーバー） */
  checked_at: Millis;
  /** クラウドに届き、応答が読めたか。false なら state/watts は前回の値ではなく unknown/null */
  ok: boolean;
  state: PlugPower;
  /** 現在の消費電力（W）。取れなければ null */
  watts: number | null;
  /** 取れなかった理由の短い要約（HTTP の状態や SwitchBot のコード。秘密は含めない） */
  error: string | null;
}

export interface StatusResponse {
  now: Millis;
  host_received_at: Millis | null;
  envs: EnvStatus[];
  /** 全環境に効く警告（Mac 応答なし、ディスク残量など） */
  alerts: StatusAlert[];
  /** スマートプラグが設定済み（Worker に token・secret・機器 ID がある）か。false なら電源の表示・操作を出さない */
  plug_enabled: boolean;
  /** スマートプラグの直近の状態。未設定、または設定済みでまだ一度も取れていなければ null */
  plug: PlugView | null;
}

/** POST /api/commands */
export interface CreateCommandRequest {
  id: string; // クライアント生成の UUID（二重送信防止）
  env: Env;
  action: Command['action'];
  args?: Command['args'];
  /** host_restart / host_power_cycle の2段階確認で入力したホスト名 */
  confirm_text?: string;
}

export interface AuditEntry {
  id: number;
  at: Millis;
  actor_email: string;
  action: string;
  target: string | null;
  detail: string | null;
}

/** GET /api/sessions の1件（タイトルは 60 文字まで） */
export interface SessionRow {
  env: Env;
  session_id: string;
  title: string | null;
  started_at: Millis | null;
  last_seen: Millis;
}

export interface ApiError {
  error: string;
}
