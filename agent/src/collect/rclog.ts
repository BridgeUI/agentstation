import { closeSync, fstatSync, openSync, readSync, statSync } from 'node:fs';
import type { RemoteControlState } from '@macmini/shared';

/**
 * `claude remote-control --debug-file` のログから Remote Control の状態を判定する。
 *
 * 実機で確認済み（docs/verify.md C-3 の材料、2026-10-31）：接続中は
 *   `[bridge:session] sessionId=… pid=…`、`[bridge:title] server title for session_…: <名前>`、
 *   `[bridge:token] Scheduled token refresh …`
 * が出る。これらを connected の根拠にする。
 * TODO(docs/verify.md C-3): 回線断・復帰・ログアウト状態の行の形は未確認。reconnecting / login_required の
 * パターンは「それらしい語」の仮判定のまま。どれにも当たらなければ unknown を返す。
 * パターンはこのファイルにだけ置き、他の場所に散らさない。
 */
export const RC_LOG_PATTERNS: Readonly<
  Record<Exclude<RemoteControlState, 'unknown'>, readonly RegExp[]>
> = {
  login_required: [
    /not logged in/i,
    /please (run|log ?in)/i,
    /authentication (required|failed|expired)/i,
    /invalid (api key|token|credentials)/i,
    /\b(401|403)\b.*unauthorized|unauthorized/i,
  ],
  reconnecting: [
    /reconnect/i,
    /connection (lost|closed|reset|refused|failed)/i,
    /\b(ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN)\b/,
    /disconnected/i,
    /retrying/i,
  ],
  connected: [
    // 接続後はログが ws メッセージと heartbeat で埋まり、起動時の行が末尾 64KB から外れる。
    // 直近の疎通の証拠（heartbeat 200、ws の受信）も connected とみなす（実機 2026-11-01）
    /\[bridge:api\] POST \S*heartbeat -> 200/,
    /\[bridge:ws\] sessionId=\S+ <<< /,
    /\[bridge:session\] sessionId=/,
    /\[bridge:title\] server title/,
    /\[bridge:token\] Scheduled token refresh/,
    /remote control.*(connected|ready|listening|started)/i,
    /(connected|ready) to .*remote/i,
    /session (registered|created|resumed|started)/i,
    /\bconnected\b/i,
  ],
};

/** 末尾からさかのぼり、最初に当たったパターンの状態を返す（新しい行を優先） */
export function classifyRcLog(text: string): RemoteControlState {
  const lines = text.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line) continue;
    // login_required → reconnecting → connected の順に見る（1 行に複数当たるときは深刻な方）
    if (RC_LOG_PATTERNS.login_required.some((p) => p.test(line))) return 'login_required';
    if (RC_LOG_PATTERNS.reconnecting.some((p) => p.test(line))) return 'reconnecting';
    if (RC_LOG_PATTERNS.connected.some((p) => p.test(line))) return 'connected';
  }
  return 'unknown';
}

export const RC_LOG_TAIL_BYTES = 64 * 1024;

/** ファイルの末尾だけ読む（ログ本文は返すだけで、外には出さない） */
export function readTail(path: string, bytes: number = RC_LOG_TAIL_BYTES): string {
  let fd: number | null = null;
  try {
    fd = openSync(path, 'r');
    const size = fstatSync(fd).size;
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/** ログが最後に書かれてからの経過ミリ秒。無ければ null */
export function logAgeMs(path: string, nowMs: number): number | null {
  try {
    return Math.max(0, nowMs - statSync(path).mtimeMs);
  } catch {
    return null;
  }
}

// ---------- 作業中判定 ----------

/**
 * 作業中判定の材料（docs/spec.md 7章「1.」）。
 * TODO(docs/verify.md C-3): スマホから作業させている間にログ・CPU がどう動くかは未確認。
 * 実機で決まるまでは「直近 10 分にログが書かれた」か「claude プロセスの CPU が 20% 超」を作業中とみなす。
 * 判定関数は setBusyJudge で差し替えられる。
 */
export interface BusyMaterials {
  /** --debug-file の最終更新からの経過ミリ秒（無ければ null） */
  logAgeMs: number | null;
  /** claude プロセスの CPU%（取れなければ null） */
  cpuPct: number | null;
  rcState: RemoteControlState;
}

export type BusyJudge = (m: BusyMaterials) => boolean;

export const BUSY_LOG_ACTIVITY_MS = 10 * 60 * 1000;
export const BUSY_CPU_PCT = 20;

export const defaultBusyJudge: BusyJudge = (m) => {
  if (m.logAgeMs !== null && m.logAgeMs < BUSY_LOG_ACTIVITY_MS) return true;
  if (m.cpuPct !== null && m.cpuPct > BUSY_CPU_PCT) return true;
  return false;
};

let busyJudge: BusyJudge = defaultBusyJudge;

export function setBusyJudge(j: BusyJudge): void {
  busyJudge = j;
}

export function isBusy(m: BusyMaterials): boolean {
  return busyJudge(m);
}
