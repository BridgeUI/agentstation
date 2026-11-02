import type { ClaudeProcessState } from '@agentstation/shared';
import type { ExecResult, Runner } from '../exec.js';

/**
 * `launchctl print gui/<uid>/<label>` の出力から state と pid を取る。
 * 出力例（抜粋）:
 *   gui/501/com.example.claude-rc = {
 *     active count = 1
 *     state = running
 *     pid = 1234
 *   }
 * サービスが登録されていないときは非 0 終了（"Could not find service"）。
 */
export interface LaunchdInfo {
  state: ClaudeProcessState;
  pid?: number;
}

export function parseLaunchctlPrint(
  r: Pick<ExecResult, 'code' | 'stdout' | 'stderr'>,
): LaunchdInfo {
  if (r.code !== 0) {
    if (/could not find service|no such process|not find/i.test(r.stderr + r.stdout)) {
      return { state: 'stopped' };
    }
    return { state: 'unknown' };
  }
  const state = /^\s*state\s*=\s*(\S+)/m.exec(r.stdout)?.[1];
  const pidText = /^\s*pid\s*=\s*(\d+)/m.exec(r.stdout)?.[1];
  const pid = pidText !== undefined ? Number(pidText) : undefined;
  if (state === undefined) return { state: 'unknown' };
  if (state === 'running')
    return pid !== undefined ? { state: 'running', pid } : { state: 'running' };
  // waiting / not running / spawn scheduled など
  return { state: 'stopped' };
}

export async function launchctlInfo(run: Runner, uid: number, label: string): Promise<LaunchdInfo> {
  const r = await run('/bin/launchctl', ['print', `gui/${uid}/${label}`], { timeoutMs: 15_000 });
  return parseLaunchctlPrint(r);
}

export function serviceTarget(uid: number, label: string): string {
  return `gui/${uid}/${label}`;
}
