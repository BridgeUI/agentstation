import { describe, expect, it } from 'vitest';
import {
  decideVmRestart,
  dueTasks,
  MAINTENANCE_WINDOW_MIN,
  maintenanceTasksFor,
  PEER_REPORT_FRESH_MS,
} from '../src/maintenance/schedule.js';
import { jstParts } from '../src/time.js';
import { AUTO_RESTART_AFTER_MS, decideWatchdog } from '../src/watchdog.js';

/** JST の時刻を unix ミリ秒に */
function jst(date: string, hh: number, mm: number): number {
  return Date.parse(
    `${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+09:00`,
  );
}

describe('JST', () => {
  it('日付と分を出す（UTC の日付と違う時間帯）', () => {
    expect(jstParts(jst('2026-11-01', 4, 10))).toEqual({ date: '2026-11-01', minutesOfDay: 250 });
    // 2026-10-31T23:30Z は JST の 11-01 08:30
    expect(jstParts(Date.parse('2026-10-31T23:30:00Z'))).toEqual({
      date: '2026-11-01',
      minutesOfDay: 510,
    });
  });
});

describe('夜間メンテナンスの予定（docs/spec.md 7章）', () => {
  it('環境ごとの時刻', () => {
    expect(maintenanceTasksFor('vm1').map((t) => [t.key, t.atMinutes])).toEqual([
      ['self_update', 240],
    ]);
    expect(maintenanceTasksFor('vm2').map((t) => [t.key, t.atMinutes])).toEqual([
      ['self_update', 260],
    ]);
    expect(maintenanceTasksFor('host').map((t) => [t.key, t.atMinutes])).toEqual([
      ['vm_restart:vm1', 250],
      ['vm_restart:vm2', 270],
      ['self_update', 280],
    ]);
  });
  it('時刻になったら 1 日 1 回だけ', () => {
    expect(dueTasks('vm1', jst('2026-11-01', 3, 59), {})).toEqual([]);
    expect(dueTasks('vm1', jst('2026-11-01', 4, 0), {}).map((t) => t.key)).toEqual(['self_update']);
    expect(dueTasks('vm1', jst('2026-11-01', 4, 30), { self_update: '2026-11-01' })).toEqual([]);
    expect(dueTasks('vm1', jst('2026-11-02', 4, 0), { self_update: '2026-11-01' })).toHaveLength(1);
  });
  it('窓を過ぎたらその日は動かない', () => {
    const late = jst('2026-11-01', 4, 0) + MAINTENANCE_WINDOW_MIN * 60_000;
    expect(dueTasks('vm1', late, {})).toEqual([]);
    expect(dueTasks('vm1', late - 60_000, {})).toHaveLength(1);
  });
  it('host は時刻順に、まだのものだけ', () => {
    expect(
      dueTasks('host', jst('2026-11-01', 4, 45), { 'vm_restart:vm1': '2026-11-01' }).map(
        (t) => t.key,
      ),
    ).toEqual(['vm_restart:vm2', 'self_update']);
  });
});

describe('host が VM を再起動するかの判定', () => {
  const now = jst('2026-11-01', 4, 10);
  it('今夜 updated なら再起動', () => {
    expect(
      decideVmRestart(
        {
          received_at: now - 60_000,
          busy: false,
          maintenance: { last_run_at: now - 5 * 60_000, last_result: 'updated' },
        },
        now,
      ),
    ).toEqual({ restart: true, reason: 'updated' });
  });
  it('busy なら見送り', () => {
    expect(
      decideVmRestart(
        {
          received_at: now - 60_000,
          busy: true,
          maintenance: { last_run_at: now - 5 * 60_000, last_result: 'busy' },
        },
        now,
      ),
    ).toEqual({ restart: false, reason: 'busy' });
  });
  it('報告が無い・古いなら VM のエージェントが死んだとみなして再起動', () => {
    expect(decideVmRestart(undefined, now)).toEqual({ restart: true, reason: 'no_report' });
    expect(
      decideVmRestart({ received_at: now - PEER_REPORT_FRESH_MS - 1, busy: false }, now),
    ).toEqual({ restart: true, reason: 'no_report' });
  });
  it('昨夜の updated は今夜の結果ではない', () => {
    expect(
      decideVmRestart(
        {
          received_at: now - 60_000,
          busy: false,
          maintenance: { last_run_at: now - 24 * 60 * 60_000, last_result: 'updated' },
        },
        now,
      ),
    ).toEqual({ restart: true, reason: 'not_updated_today' });
  });
});

describe('ログ監視による自動の立て直し（1 時間に 3 回まで）', () => {
  const t0 = 1_000_000_000_000;
  it('reconnecting が 5 分続いたら 1 回だけ立て直す', () => {
    const a = decideWatchdog({
      claude: { state: 'running', rc_state: 'reconnecting' },
      nowMs: t0,
      reconnectingSince: null,
      autoRestarts: [],
    });
    expect(a).toEqual({
      reconnectingSince: t0,
      restart: false,
      exhausted: false,
      autoRestarts: [],
    });
    const b = decideWatchdog({
      claude: { state: 'running', rc_state: 'reconnecting' },
      nowMs: t0 + AUTO_RESTART_AFTER_MS,
      reconnectingSince: a.reconnectingSince,
      autoRestarts: [],
    });
    expect(b.restart).toBe(true);
    expect(b.reconnectingSince).toBeNull();
    expect(b.autoRestarts).toEqual([t0 + AUTO_RESTART_AFTER_MS]);
  });
  it('connected に戻れば計測をやめる', () => {
    expect(
      decideWatchdog({
        claude: { state: 'running', rc_state: 'connected' },
        nowMs: t0,
        reconnectingSince: t0 - 60_000,
        autoRestarts: [t0 - 3_600_000 - 1, t0 - 10],
      }),
    ).toEqual({
      reconnectingSince: null,
      restart: false,
      exhausted: false,
      autoRestarts: [t0 - 10],
    });
  });
  it('login_required と stopped は触らない', () => {
    for (const claude of [
      { state: 'running', rc_state: 'login_required' },
      { state: 'stopped', rc_state: 'reconnecting' },
    ] as const) {
      expect(
        decideWatchdog({ claude, nowMs: t0, reconnectingSince: t0 - 3_600_000, autoRestarts: [] })
          .restart,
      ).toBe(false);
    }
  });
  it('1 時間に 3 回を超えたら止める', () => {
    const d = decideWatchdog({
      claude: { state: 'running', rc_state: 'reconnecting' },
      nowMs: t0,
      reconnectingSince: t0 - AUTO_RESTART_AFTER_MS,
      autoRestarts: [t0 - 3000, t0 - 2000, t0 - 1000],
    });
    expect(d).toMatchObject({ restart: false, exhausted: true });
  });
});
