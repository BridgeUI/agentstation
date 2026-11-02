import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isRcDirName, type MaintenanceResult, type MaintenanceStatus } from '@agentstation/shared';

/**
 * 再起動をまたいで持ちたい小さな状態（~/.config/agentstation/state.json）。
 * 秘密情報・パス・セッションの中身は入れない。
 */
export interface AgentState {
  /** 夜間メンテナンスの各タスクの最終実行日（JST の YYYY-MM-DD）。1 日 1 回だけ動かすため */
  maintenance_runs: Record<string, string>;
  /** ハートビートに載せる自分の環境のメンテナンス結果 */
  maintenance?: MaintenanceStatus;
  /** Remote Control を最後に立て直した時刻（claude.last_restart） */
  rc_last_restart?: number;
  /** ログ監視による自動の立て直しの時刻（直近 1 時間分だけ残す） */
  auto_restarts: number[];
  /** フォルダを選んで起動する追加の RC の希望集合（フォルダ名だけ） */
  rc_dirs: string[];
}

export function emptyState(): AgentState {
  return { maintenance_runs: {}, auto_restarts: [], rc_dirs: [] };
}

export function parseState(text: string): AgentState {
  const raw = JSON.parse(text) as unknown;
  if (typeof raw !== 'object' || raw === null) return emptyState();
  const r = raw as Record<string, unknown>;
  const state = emptyState();
  if (typeof r.maintenance_runs === 'object' && r.maintenance_runs !== null) {
    for (const [k, v] of Object.entries(r.maintenance_runs as Record<string, unknown>)) {
      if (typeof v === 'string') state.maintenance_runs[k] = v;
    }
  }
  if (typeof r.maintenance === 'object' && r.maintenance !== null) {
    const m = r.maintenance as Record<string, unknown>;
    const ms: MaintenanceStatus = {};
    if (typeof m.last_run_at === 'number') ms.last_run_at = m.last_run_at;
    if (typeof m.last_result === 'string') {
      ms.last_result = m.last_result as MaintenanceResult;
    }
    state.maintenance = ms;
  }
  if (typeof r.rc_last_restart === 'number') state.rc_last_restart = r.rc_last_restart;
  if (Array.isArray(r.auto_restarts)) {
    state.auto_restarts = r.auto_restarts.filter((x): x is number => typeof x === 'number');
  }
  if (Array.isArray(r.rc_dirs)) {
    state.rc_dirs = r.rc_dirs.filter((x): x is string => isRcDirName(x));
  }
  return state;
}

export function loadState(path: string): AgentState {
  try {
    return parseState(readFileSync(path, 'utf8'));
  } catch {
    return emptyState();
  }
}

/** 書きかけで壊れないように一時ファイルに書いてから rename する */
export function saveState(path: string, state: AgentState): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, path);
}
