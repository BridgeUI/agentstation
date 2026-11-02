import {
  COMMAND_SPECS,
  isCommandAction,
  isVmEnv,
  type Command,
  type CommandResult,
} from '@macmini/shared';
import { summarizeOutput } from '../send/filter.js';
import { codexRestart } from './codex.js';
import type { ActionContext, ActionOutcome } from './context.js';
import { hostRestartAllowed, hostRestartExecute, hostRestartPrepare } from './host.js';
import {
  claudePermissionSet,
  claudeUpdate,
  rcPermissionSet,
  rcRestart,
  sessionRestore,
} from './rc.js';
import { rcMkdir, rcStartDir, rcStopDir } from './rcdirs.js';
import { vmRestart, vmStart, vmStop } from './vm.js';

/**
 * 指示の実行（ホワイトリストだけ。docs/spec.md 6章、CLAUDE.md 2）。
 * action ごとに関数が決まっていて、任意の文字列をシェルに渡す経路は無い。
 */

export interface ExecuteOptions {
  /** 同じ応答で受け取った指示（host_restart の「最新」判定に使う） */
  batch: readonly Command[];
  /** host_restart で shutdown の前に result を送るためのフック */
  sendResult: (r: CommandResult) => Promise<boolean>;
}

/** 実行できる指示かを先に確かめる（サーバーも確認しているが、こちらでも判定する） */
export function validateCommand(cmd: Command, selfEnv: string): string | null {
  if (!isCommandAction(cmd.action)) return '知らない action';
  if (cmd.executor !== selfEnv) return 'この環境が実行者ではない';
  const spec = COMMAND_SPECS[cmd.action];
  if (!(spec.targets as readonly string[]).includes(cmd.env))
    return 'この action の対象にできない環境';
  if (spec.executor === 'self' && cmd.env !== selfEnv) return '自分の環境向けではない';
  if (spec.executor === 'host' && selfEnv !== 'host') return 'host だけが実行する action';
  return null;
}

export async function executeCommand(
  cmd: Command,
  ctx: ActionContext,
  opts: ExecuteOptions,
): Promise<CommandResult> {
  const invalid = validateCommand(cmd, ctx.cfg.env);
  if (invalid) return { id: cmd.id, status: 'failed', output: invalid };

  let outcome: ActionOutcome;
  try {
    outcome = await dispatch(cmd, ctx, opts);
  } catch (e) {
    outcome = { ok: false, summary: `例外: ${summarizeOutput((e as Error).message)}` };
  }
  if (outcome.ok && cmd.action === 'host_restart') {
    // 先に done を送ってから shutdown（送らないと running のまま残る）
    const sent = await opts.sendResult({
      id: cmd.id,
      status: 'done',
      output: summarizeOutput(outcome.summary),
    });
    if (!sent) {
      return { id: cmd.id, status: 'failed', output: '結果を送れなかったため shutdown を見送った' };
    }
    const sd = await hostRestartExecute(ctx);
    if (!sd.ok) ctx.log.error('shutdown に失敗', { summary: sd.summary });
    // 既に done を送っているので、ここで返す結果は送らない（loop 側が sentAlready を見る）
    return { id: cmd.id, status: 'done', output: summarizeOutput(outcome.summary) };
  }
  return {
    id: cmd.id,
    status: outcome.ok ? 'done' : 'failed',
    output: summarizeOutput(outcome.summary),
  };
}

async function dispatch(
  cmd: Command,
  ctx: ActionContext,
  opts: ExecuteOptions,
): Promise<ActionOutcome> {
  switch (cmd.action) {
    case 'rc_restart':
      return rcRestart(ctx);
    case 'session_restore':
      return sessionRestore(ctx, cmd.args?.session_id);
    case 'rc_start_dir':
      return rcStartDir(ctx, cmd.args?.dir, cmd.id);
    case 'rc_stop_dir':
      return rcStopDir(ctx, cmd.args?.dir);
    case 'rc_mkdir':
      return rcMkdir(ctx, cmd.args?.dir, cmd.args?.start === true, cmd.id);
    case 'rc_permission_set':
      return rcPermissionSet(ctx, cmd.args?.permission_mode, cmd.id);
    case 'claude_permission_set':
      return claudePermissionSet(ctx, cmd.args?.permission_mode);
    case 'claude_update':
      return claudeUpdate(ctx);
    case 'codex_restart':
      return codexRestart(ctx);
    case 'vm_restart':
    case 'vm_stop':
    case 'vm_start':
      if (!isVmEnv(cmd.env)) return { ok: false, summary: '対象が VM ではない' };
      if (!ctx.cfg.vms.includes(cmd.env))
        return { ok: false, summary: `${cmd.env} はこの Mac の設定（vms）に無い` };
      return cmd.action === 'vm_restart'
        ? vmRestart(ctx, cmd.env)
        : cmd.action === 'vm_stop'
          ? vmStop(ctx, cmd.env)
          : vmStart(ctx, cmd.env);
    case 'host_restart': {
      const allowed = hostRestartAllowed(cmd, opts.batch, ctx.now());
      if (!allowed.ok) return { ok: false, summary: allowed.reason };
      return hostRestartPrepare(ctx);
    }
    case 'host_power_cycle':
      // Worker が SwitchBot のクラウドで実行する（executor は 'cloud'）。エージェントには渡らない（docs/spec.md 6.1）
      return { ok: false, summary: 'エージェントでは実行しない action（Worker が実行する）' };
  }
}
