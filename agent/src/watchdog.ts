import type { ClaudeStatus } from '@agentstation/shared';

/**
 * ログ監視による自動の立て直し（docs/spec.md 7章「3.」）。
 * reconnecting が続いたら Remote Control を kickstart する。同じ環境で 1 時間に 3 回まで。
 * 超えたらログに出して止める（通知は Worker の Cron が「再接続待ちのまま 15 分」で出す）。
 * login_required は自動では直せないので触らない。
 */
export const AUTO_RESTART_AFTER_MS = 5 * 60 * 1000;
export const AUTO_RESTART_MAX_PER_HOUR = 3;
const HOUR_MS = 60 * 60 * 1000;

export interface WatchdogInput {
  claude: Pick<ClaudeStatus, 'state' | 'rc_state'>;
  nowMs: number;
  /** reconnecting が始まった時刻（前回の判定結果） */
  reconnectingSince: number | null;
  /** 直近の自動再起動の時刻 */
  autoRestarts: readonly number[];
}

export interface WatchdogDecision {
  reconnectingSince: number | null;
  /** 今回 kickstart するか */
  restart: boolean;
  /** 上限に達して止めているか */
  exhausted: boolean;
  /** 1 時間より古いものを落とした一覧（restart なら nowMs を足す） */
  autoRestarts: number[];
}

export function decideWatchdog(input: WatchdogInput): WatchdogDecision {
  const recent = input.autoRestarts.filter((t) => input.nowMs - t < HOUR_MS);
  const failing = input.claude.state === 'running' && input.claude.rc_state === 'reconnecting';
  if (!failing)
    return { reconnectingSince: null, restart: false, exhausted: false, autoRestarts: recent };

  const since = input.reconnectingSince ?? input.nowMs;
  if (input.nowMs - since < AUTO_RESTART_AFTER_MS) {
    return { reconnectingSince: since, restart: false, exhausted: false, autoRestarts: recent };
  }
  if (recent.length >= AUTO_RESTART_MAX_PER_HOUR) {
    return { reconnectingSince: since, restart: false, exhausted: true, autoRestarts: recent };
  }
  // 立て直したら計測をやり直す
  return {
    reconnectingSince: null,
    restart: true,
    exhausted: false,
    autoRestarts: [...recent, input.nowMs],
  };
}
