import { describe, expect, it } from 'vitest';
import { AFTER_COMMAND_FULL_MS, decideFull, nextDelay } from '../src/cadence.js';

describe('報告の間隔', () => {
  const base = { lastFullAt: 1_000_000, lastCommandAt: 0, intervalMs: 60_000 };
  it('設定の間隔が経てばフル、途中は軽い問い合わせ', () => {
    expect(decideFull({ ...base, now: 1_000_000 + 5_000 })).toBe(false);
    expect(decideFull({ ...base, now: 1_000_000 + 59_000 })).toBe(true);
    expect(decideFull({ ...base, now: 1_000_000 + 60_000 })).toBe(true);
    expect(decideFull({ ...base, lastFullAt: 0, now: 1 })).toBe(true);
  });
  it('指示を実行した直後の 60 秒は毎回フル', () => {
    const t = 1_000_000 + 5_000;
    expect(decideFull({ ...base, now: t, lastCommandAt: t - 1_000 })).toBe(true);
    expect(decideFull({ ...base, now: t, lastCommandAt: t - AFTER_COMMAND_FULL_MS })).toBe(false);
  });
  it('サーバーの間隔は 5 秒〜設定の間隔に収める。応答が無ければ設定の間隔', () => {
    expect(nextDelay(5_000, 60_000)).toBe(5_000);
    expect(nextDelay(1_000, 60_000)).toBe(5_000);
    expect(nextDelay(600_000, 60_000)).toBe(60_000);
    expect(nextDelay(undefined, 60_000)).toBe(60_000);
    expect(nextDelay(60_000, 30_000)).toBe(30_000);
  });
});
