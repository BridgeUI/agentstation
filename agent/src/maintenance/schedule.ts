import type { Env, PeerSummary, VmEnv } from '@macmini/shared';
import { hhmm, jstParts } from '../time.js';

/**
 * 夜間メンテナンスの予定表（docs/spec.md 7章。JST、環境ごとに時刻をずらす）。
 *
 * | 04:00 | vm1  | 作業中判定 → busy なら見送り → claude update → updated
 * | 04:10 | host | peers.vm1 を見て VM 再起動
 * | 04:20 | vm2  | vm1 と同じ
 * | 04:30 | host | vm2 の再起動
 * | 04:40 | host | host 自身の更新と Remote Control 再起動
 */
export type MaintenanceKind = 'self_update' | 'vm_restart';

export interface MaintenanceTask {
  /** 状態ファイルの最終実行日のキー */
  key: string;
  kind: MaintenanceKind;
  /** vm_restart の対象 */
  vm?: VmEnv;
  /** JST の 0:00 からの分 */
  atMinutes: number;
}

/** 予定時刻からこの時間を過ぎたら、その日は実行しない（起動が遅れて昼に走るのを防ぐ） */
export const MAINTENANCE_WINDOW_MIN = 90;

export function maintenanceTasksFor(env: Env): MaintenanceTask[] {
  switch (env) {
    case 'vm1':
      return [{ key: 'self_update', kind: 'self_update', atMinutes: hhmm(4, 0) }];
    case 'vm2':
      return [{ key: 'self_update', kind: 'self_update', atMinutes: hhmm(4, 20) }];
    case 'host':
      return [
        { key: 'vm_restart:vm1', kind: 'vm_restart', vm: 'vm1', atMinutes: hhmm(4, 10) },
        { key: 'vm_restart:vm2', kind: 'vm_restart', vm: 'vm2', atMinutes: hhmm(4, 30) },
        { key: 'self_update', kind: 'self_update', atMinutes: hhmm(4, 40) },
      ];
  }
}

/** 今やるべきタスク（時刻順）。runs は key → 最終実行日（JST） */
export function dueTasks(
  env: Env,
  nowMs: number,
  runs: Readonly<Record<string, string>>,
): MaintenanceTask[] {
  const { date, minutesOfDay } = jstParts(nowMs);
  return maintenanceTasksFor(env)
    .filter(
      (t) => minutesOfDay >= t.atMinutes && minutesOfDay < t.atMinutes + MAINTENANCE_WINDOW_MIN,
    )
    .filter((t) => runs[t.key] !== date)
    .sort((a, b) => a.atMinutes - b.atMinutes);
}

/** host が VM を再起動するかの判定（docs/spec.md 7章の 04:10 / 04:30） */
export type VmRestartDecision =
  | { restart: true; reason: 'updated' | 'no_report' | 'not_updated_today' }
  | { restart: false; reason: 'busy' };

/** VM 側の報告が「今夜のもの」とみなす範囲（04:00 の作業が 03:50 以降に始まることはない） */
export const PEER_REPORT_FRESH_MS = 60 * 60 * 1000;

export function decideVmRestart(peer: PeerSummary | undefined, nowMs: number): VmRestartDecision {
  if (!peer) return { restart: true, reason: 'no_report' };
  const m = peer.maintenance;
  const tonight = m?.last_run_at !== undefined && nowMs - m.last_run_at < PEER_REPORT_FRESH_MS;
  if (peer.busy || (tonight && m?.last_result === 'busy'))
    return { restart: false, reason: 'busy' };
  if (tonight && m?.last_result === 'updated') return { restart: true, reason: 'updated' };
  // 報告が古い／今夜の結果が無い／failed → VM のエージェントが死んでいるか更新に失敗したとみなし再起動
  if (nowMs - peer.received_at > PEER_REPORT_FRESH_MS)
    return { restart: true, reason: 'no_report' };
  return { restart: true, reason: 'not_updated_today' };
}
