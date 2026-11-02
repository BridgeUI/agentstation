import type { ClaudeStatus, CodexStatus } from '@macmini/shared';
import type { AgentConfig } from '../config.js';
import type { Runner } from '../exec.js';
import { launchctlInfo, type LaunchdInfo } from './launchctl.js';
import { classifyRcLog, readTail } from './rclog.js';
import { parseClaudeVersion } from './usage.js';

/** 自分の環境の Claude（Remote Control）の状態。docs/spec.md 3.6「2.」 */
export interface ClaudeCollected {
  status: ClaudeStatus;
  launchd: LaunchdInfo;
}

export async function collectClaude(
  run: Runner,
  cfg: AgentConfig,
  lastRestart: number | undefined,
  readLogTail: (path: string) => string = readTail,
): Promise<ClaudeCollected> {
  const launchd = await launchctlInfo(run, cfg.uid, cfg.labels.claudeRc);
  const versionResult = await run(cfg.claudePath, ['--version'], { timeoutMs: 20_000 });
  const version = versionResult.code === 0 ? parseClaudeVersion(versionResult.stdout) : undefined;
  const logState = classifyRcLog(readLogTail(cfg.rcDebugLog));
  const status = buildClaudeStatus({ launchd, logState, version, lastRestart });
  return { status, launchd };
}

export function buildClaudeStatus(input: {
  launchd: LaunchdInfo;
  logState: ClaudeStatus['rc_state'];
  version: string | undefined;
  lastRestart: number | undefined;
}): ClaudeStatus {
  // プロセスが動いていないのにログが connected と言っていても信じない
  const rc_state =
    input.launchd.state !== 'running' && input.logState === 'connected'
      ? 'unknown'
      : input.logState;
  const status: ClaudeStatus = { state: input.launchd.state, rc_state };
  if (input.version !== undefined) status.version = input.version;
  // チャンネルは settings.json の autoUpdatesChannel で stable に固定する運用（docs/spec.md 7章）
  status.channel = 'stable';
  if (input.lastRestart !== undefined) status.last_restart = input.lastRestart;
  return status;
}

/**
 * Codex の状態（docs/verify.md C-5 の結果）。ChatGPT デスクトップアプリ（codex_app）ならプロセスの有無、
 * launchd の daemon（labels.codex）ならその state。どちらも無ければ unknown。
 */
export async function collectCodex(run: Runner, cfg: AgentConfig): Promise<CodexStatus> {
  if (cfg.codexApp !== null) {
    const r = await run('/usr/bin/pgrep', ['-f', `${cfg.codexApp}/Contents/MacOS/`]);
    return { state: r.code === 0 ? 'running' : 'stopped' };
  }
  if (cfg.labels.codex === null) return { state: 'unknown' };
  const info = await launchctlInfo(run, cfg.uid, cfg.labels.codex);
  return { state: info.state };
}
