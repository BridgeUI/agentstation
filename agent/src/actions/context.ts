import type { AgentConfig } from '../config.js';
import type { Runner } from '../exec.js';
import type { Logger } from '../log.js';
import type { TrustDeps } from '../claudetrust.js';
import type { RcDirManager } from '../rcdirs/manager.js';
import type { AgentState } from '../state.js';

/** 操作が使うもの。外部コマンドは必ず run（execFile）で呼ぶ */
export interface ActionContext {
  cfg: AgentConfig;
  run: Runner;
  log: Logger;
  state: AgentState;
  saveState: () => void;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Remote Control のログ末尾を読む（テストで差し替える） */
  readRcLogTail: () => string;
  /** フォルダを選んで起動する追加の RC（rc_start_dir / rc_stop_dir）。無ければその action は失敗にする */
  rcDirs?: Pick<RcDirManager, 'start' | 'stop' | 'desired'>;
  /** フォルダの信頼の記録（~/.claude.json）。無ければ実ファイル（claudetrust.ts の realTrust） */
  trust?: TrustDeps;
}

export interface ActionOutcome {
  ok: boolean;
  /** 要約だけ（summarizeOutput を通す） */
  summary: string;
}

export function okOutcome(summary: string): ActionOutcome {
  return { ok: true, summary };
}

export function failOutcome(summary: string): ActionOutcome {
  return { ok: false, summary };
}
