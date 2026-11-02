/** JST（Asia/Tokyo）は夏時間が無いので固定オフセットで計算する。夜間メンテナンスはこれで判定する。 */

export const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export interface JstParts {
  /** YYYY-MM-DD */
  date: string;
  /** 0:00 からの経過分 */
  minutesOfDay: number;
}

export function jstParts(ms: number): JstParts {
  const d = new Date(ms + JST_OFFSET_MS);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return {
    date: `${y}-${m}-${day}`,
    minutesOfDay: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}

export function hhmm(h: number, m: number): number {
  return h * 60 + m;
}
