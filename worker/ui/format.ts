import type { Millis } from '@macmini/shared';

/** 時刻の表示はすべて JST（docs/spec.md 10章）。端末のタイムゾーンに依存しない。 */
const TZ = 'Asia/Tokyo';

const fmtTime = new Intl.DateTimeFormat('ja-JP', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const fmtDay = new Intl.DateTimeFormat('ja-JP', { timeZone: TZ, month: 'numeric', day: 'numeric' });
const fmtYmd = new Intl.DateTimeFormat('ja-JP', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function ymd(ms: Millis): string {
  return fmtYmd.format(new Date(ms));
}

/** "15:12" */
export function hm(ms: Millis): string {
  return fmtTime.format(new Date(ms));
}

/** 今日なら "15:12"、昨日なら "昨日 15:12"、それ以前は "10/30 15:12"。now はサーバー時刻 */
export function dayTime(ms: Millis, now: Millis): string {
  const d = ymd(ms);
  if (d === ymd(now)) return hm(ms);
  if (d === ymd(now - 24 * 60 * 60 * 1000)) return `昨日 ${hm(ms)}`;
  return `${fmtDay.format(new Date(ms))} ${hm(ms)}`;
}

/** 「今日 04:00」のような、文章向けの表記 */
export function dayTimeLong(ms: Millis, now: Millis): string {
  const d = ymd(ms);
  if (d === ymd(now)) return `今日 ${hm(ms)}`;
  if (d === ymd(now - 24 * 60 * 60 * 1000)) return `昨日 ${hm(ms)}`;
  return `${fmtDay.format(new Date(ms))} ${hm(ms)}`;
}

/** "12秒前" "3分前" "2時間前" "3日前"。差はサーバーの now と received_at で取る */
export function ago(ms: Millis | null, now: Millis): string {
  if (ms === null) return '未受信';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}秒前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}時間前`;
  return `${Math.floor(h / 24)}日前`;
}

/** 分単位の経過（"14分間"） */
export function minutesSince(ms: Millis, now: Millis): number {
  return Math.max(0, Math.floor((now - ms) / 60000));
}

export function pct(used: number | undefined, total: number | undefined): number | null {
  if (used === undefined || total === undefined || !(total > 0)) return null;
  return Math.max(0, Math.min(100, Math.round((used / total) * 100)));
}

export function gb(v: number | undefined, digits = 0): string {
  if (v === undefined) return '—';
  return `${v.toFixed(digits)}GB`;
}
