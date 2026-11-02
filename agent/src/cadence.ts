import { POLL_FAST_MS } from '@macmini/shared';

/**
 * 報告の間隔（docs/spec.md 3.6）。Mac からは外向きだけなので、速さは Worker を見に行く間隔で決まる。
 * - ふだんは設定の間隔（60 秒）でフルの報告（集めて送る）
 * - サーバーが poll_ms で短い間隔（5 秒）を返したら、その間隔で見に行く。ただし毎回フルには集めず、
 *   軽い問い合わせ（POST /api/agent/poll）にして、フルの報告は設定の間隔ごとにする
 * - 指示を実行した直後の 60 秒は毎回フルの報告にする（「起動中 → 稼働中」などの変化を早く見せる）
 */
export const AFTER_COMMAND_FULL_MS = 60 * 1000;

export interface TickInput {
  now: number;
  /** 最後にフルの報告を送った時刻（まだなら 0） */
  lastFullAt: number;
  /** 最後に指示を実行し終えた時刻（まだなら 0） */
  lastCommandAt: number;
  intervalMs: number;
}

/** この回はフルの報告にするか（false なら軽い問い合わせだけ） */
export function decideFull(t: TickInput): boolean {
  if (t.now - t.lastFullAt >= t.intervalMs - 1000) return true;
  if (t.now - t.lastCommandAt < AFTER_COMMAND_FULL_MS) return true;
  return false;
}

/** サーバーが返した間隔を 5 秒〜設定の間隔に収める。応答が無ければ設定の間隔 */
export function nextDelay(pollMs: number | undefined, intervalMs: number): number {
  if (pollMs === undefined) return intervalMs;
  return Math.min(Math.max(pollMs, POLL_FAST_MS), intervalMs);
}
