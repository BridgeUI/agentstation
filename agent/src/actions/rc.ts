import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { isRcPermissionMode } from '@agentstation/shared';
import { prepareMainRc, realTrust } from '../claudetrust.js';
import { readRcSettings, writeRcSettings } from '../rcsettings.js';
import {
  applyClaudePermissionMode,
  readClaudeDefaultMode,
  readTextOrNull,
  writeClaudeSettings,
} from '../claudesettings.js';
import { dirname } from 'node:path';
import { serviceTarget } from '../collect/launchctl.js';
import { classifyRcLog } from '../collect/rclog.js';
import { summarizeOutput } from '../send/filter.js';
import { failOutcome, okOutcome, type ActionContext, type ActionOutcome } from './context.js';

/** Remote Control まわりの操作（docs/spec.md 6章） */

export const CONNECT_WAIT_MS = 3 * 60 * 1000;
export const CONNECT_POLL_MS = 10 * 1000;
export const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function isValidSessionId(id: unknown): id is string {
  return typeof id === 'string' && SESSION_ID_PATTERN.test(id);
}

/** `launchctl kickstart -k gui/<uid>/<label>`：止めて同じ作業フォルダで起動し直す（plist の WorkingDirectory） */
export async function rcRestart(ctx: ActionContext): Promise<ActionOutcome> {
  // 立て直す前に、作業フォルダの信頼と Remote Control の同意が記録されているかを確かめる（初回や ~/.claude.json を作り直したあと）
  const prep = prepareMainRc(ctx.trust ?? realTrust, ctx.cfg.claudeJsonFile, ctx.cfg.workDir);
  if (!prep.ok) ctx.log.error('初回の答えを記録できない', { reason: prep.reason });
  else if (prep.trusted || prep.consented)
    ctx.log.info('Remote Control の初回の答えを記録した', {
      trusted: prep.trusted,
      consented: prep.consented,
    });
  const r = await ctx.run(
    '/bin/launchctl',
    ['kickstart', '-k', serviceTarget(ctx.cfg.uid, ctx.cfg.labels.claudeRc)],
    { timeoutMs: 30_000 },
  );
  if (r.code !== 0)
    return failOutcome(`kickstart 失敗 (code=${r.code}) ${summarizeOutput(r.stderr)}`);
  ctx.state.rc_last_restart = ctx.now();
  ctx.saveState();
  return okOutcome('Remote Control を再起動した');
}

/** ログが connected になるまで待つ（最大 3 分） */
export async function waitConnected(
  ctx: ActionContext,
  maxMs: number = CONNECT_WAIT_MS,
): Promise<boolean> {
  const deadline = ctx.now() + maxMs;
  while (ctx.now() < deadline) {
    await ctx.sleep(CONNECT_POLL_MS);
    const st = classifyRcLog(ctx.readRcLogTail());
    if (st === 'connected') return true;
    if (st === 'login_required') return false;
  }
  return false;
}

/**
 * session_restore：`claude remote-control --session-id <id>` を同じ作業フォルダで起動し直す。
 *
 * TODO(docs/verify.md C-2): --session-id の取り方と、停止→再起動で戻るかは未確認。
 * plist は書き換えない。代わりに ~/.config/agentstation/session.json に {"session_id": "..."} を書き、
 * kickstart する。plist 側の ProgramArguments は claude を直接ではなくラッパー（mac/launchd のシェル
 * スクリプト。フェーズ2で用意）を指し、ラッパーがこのファイルがあれば --session-id を付けて起動し、
 * 起動後にファイルを消す想定。ここでは接続確認が終わった時点でもファイルを消す（残すと KeepAlive の
 * 再起動のたびに古いセッションを指し続けるため）。
 */
export async function sessionRestore(
  ctx: ActionContext,
  sessionId: unknown,
): Promise<ActionOutcome> {
  if (!isValidSessionId(sessionId)) return failOutcome('session_id の形が不正');
  try {
    mkdirSync(dirname(ctx.cfg.sessionFile), { recursive: true });
    writeFileSync(ctx.cfg.sessionFile, JSON.stringify({ session_id: sessionId }) + '\n', {
      mode: 0o600,
    });
  } catch {
    return failOutcome('セッション指定ファイルを書けない');
  }
  try {
    const restarted = await rcRestart(ctx);
    if (!restarted.ok) return restarted;
    const connected = await waitConnected(ctx);
    return connected
      ? okOutcome('セッションを指定して Remote Control を再起動し、接続を確認した')
      : failOutcome('再起動したが 3 分以内に接続を確認できなかった');
  } finally {
    try {
      unlinkSync(ctx.cfg.sessionFile);
    } catch {
      /* ラッパーが先に消していればよい */
    }
  }
}

/** claude_update：`claude update` → rc_restart → 接続確認 */
export async function claudeUpdate(ctx: ActionContext): Promise<ActionOutcome> {
  const r = await ctx.run(ctx.cfg.claudePath, ['update'], {
    timeoutMs: 5 * 60 * 1000,
    cwd: ctx.cfg.workDir,
  });
  if (r.code !== 0) {
    return failOutcome(
      `claude update 失敗 (code=${r.code}) ${summarizeOutput(r.stderr || r.stdout)}`,
    );
  }
  const restarted = await rcRestart(ctx);
  if (!restarted.ok) return failOutcome(`更新後の再起動に失敗: ${restarted.summary}`);
  const connected = await waitConnected(ctx);
  return connected
    ? okOutcome('更新して Remote Control を再起動し、接続を確認した')
    : failOutcome('更新して再起動したが 3 分以内に接続を確認できなかった');
}

/**
 * rc_permission_set：Remote Control の権限モードを切り替える（docs/spec.md 13章 #18）。
 * rc.json に書いて、メインの RC を立て直し、動いているフォルダごとの RC も起動し直す。
 */
export async function rcPermissionSet(
  ctx: ActionContext,
  mode: unknown,
  commandId: string,
): Promise<ActionOutcome> {
  if (!isRcPermissionMode(mode)) return failOutcome('permission_mode の値が不正');
  const current = readRcSettings(ctx.cfg.rcSettingsFile).permission_mode;
  try {
    writeRcSettings(ctx.cfg.rcSettingsFile, { permission_mode: mode });
  } catch {
    return failOutcome('rc.json を書けなかった');
  }
  const restarted = await rcRestart(ctx);
  const m = ctx.rcDirs;
  let dirs = 0;
  if (m) {
    for (const dir of m.desired()) {
      m.stop(dir);
      if (m.start(dir, commandId).ok) dirs++;
    }
    ctx.state.rc_dirs = m.desired();
    ctx.saveState();
  }
  const label = mode === 'bypassPermissions' ? '権限の確認を省く' : '権限を毎回確認する';
  if (!restarted.ok)
    return failOutcome(`${label} に設定したが立て直しに失敗: ${restarted.summary}`);
  return okOutcome(
    `${label} に設定した（${current === mode ? '変更なし' : `${current} → ${mode}`}、フォルダごとの RC ${dirs} 件を起動し直し）`,
  );
}

/**
 * claude_permission_set：Claude Code 全体の既定の権限モードを切り替える（docs/spec.md 13章 #20）。
 * ~/.claude/settings.json の permissions.defaultMode（bypass のときは skipDangerousModePermissionPrompt も）
 * だけを書き換え、ほかのキーは残す。次に起動する claude から効く。動いている RC は立て直さない
 * （RC の権限モードは rc.json 側。rc_permission_set）。
 */
export function claudePermissionSet(ctx: ActionContext, mode: unknown): ActionOutcome {
  if (!isRcPermissionMode(mode)) return failOutcome('permission_mode の値が不正');
  const path = ctx.cfg.claudeSettingsFile;
  const before = readTextOrNull(path);
  const current = readClaudeDefaultMode(before).defaultMode ?? '未設定';
  const edit = applyClaudePermissionMode(before, mode);
  if (!edit.ok) return failOutcome(edit.reason);
  try {
    writeClaudeSettings(path, edit.text);
  } catch {
    return failOutcome('settings.json を書けなかった');
  }
  const label = mode === 'bypassPermissions' ? '権限の確認を省く' : '権限を毎回確認する';
  return okOutcome(
    `Claude Code の既定を「${label}」にした（${current === mode ? '変更なし' : `${current} → ${mode}`}。次に起動する claude から有効）`,
  );
}
