import type { Command } from '@macmini/shared';
import { failOutcome, okOutcome, type ActionContext, type ActionOutcome } from './context.js';
import { tartStop } from './vm.js';

/** host_restart（docs/spec.md 6章「ホスト再起動の安全策」） */

export const HOST_RESTART_MAX_AGE_MS = 15 * 60 * 1000;

/**
 * 「not_before を過ぎていて、登録から 15 分以内で、host 向けの最新の指示」だけを実行する。
 * all は同じ応答で受け取った指示の一覧（最新かどうかの判定に使う）。
 */
export function hostRestartAllowed(
  cmd: Command,
  all: readonly Command[],
  nowMs: number,
): { ok: true } | { ok: false; reason: string } {
  if (cmd.not_before !== null && nowMs < cmd.not_before) {
    return { ok: false, reason: '取り消し猶予（not_before）がまだ過ぎていない' };
  }
  if (nowMs - cmd.created_at > HOST_RESTART_MAX_AGE_MS) {
    return { ok: false, reason: '登録から 15 分を過ぎた古い指示' };
  }
  const newest = all
    .filter((c) => c.action === 'host_restart' && c.env === 'host')
    .reduce<Command | null>((a, c) => (a === null || c.created_at > a.created_at ? c : a), null);
  if (newest !== null && newest.id !== cmd.id) {
    return { ok: false, reason: 'より新しいホスト再起動の指示がある' };
  }
  return { ok: true };
}

/**
 * 使っている VM（0〜2 台）を `tart stop`（disable はしない。再起動後に KeepAlive で戻る）→ 呼び出し側が result を done で
 * 先に送る → この関数の後半 shutdown を実行する。そのため 2 段階に分けている。
 */
export async function hostRestartPrepare(ctx: ActionContext): Promise<ActionOutcome> {
  const failed: string[] = [];
  for (const vm of ctx.cfg.vms) {
    const r = await tartStop(ctx, vm);
    if (!r.ok) failed.push(vm);
  }
  if (failed.length > 0) {
    return failOutcome(`VM の停止に失敗したため再起動しない: ${failed.join(',')}`);
  }
  return okOutcome('VM を停止した。ホストを再起動する');
}

/** `sudo /sbin/shutdown -r now`。sudoers でこの 1 コマンドだけ NOPASSWD（mac/sudoers.d） */
export async function hostRestartExecute(ctx: ActionContext): Promise<ActionOutcome> {
  const r = await ctx.run(ctx.cfg.sudoPath, ['-n', ctx.cfg.shutdownPath, '-r', 'now'], {
    timeoutMs: 60_000,
  });
  if (r.code !== 0) return failOutcome(`shutdown 失敗 (code=${r.code})`);
  return okOutcome('shutdown を実行した');
}
