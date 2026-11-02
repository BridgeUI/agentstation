import type { VmEnv } from '@macmini/shared';
import { serviceTarget } from '../collect/launchctl.js';
import { tartIp } from '../collect/tart.js';
import { summarizeOutput } from '../send/filter.js';
import { failOutcome, okOutcome, type ActionContext, type ActionOutcome } from './context.js';

/** VM の操作（host だけ。docs/spec.md 3.5・6章） */

export const VM_IP_WAIT_MS = 3 * 60 * 1000;
export const VM_IP_POLL_MS = 10 * 1000;

function tartOf(ctx: ActionContext): string | null {
  return ctx.cfg.env === 'host' ? ctx.cfg.tartPath : null;
}

/** `tart stop <vm>`。既に止まっていても失敗扱いにしない */
export async function tartStop(ctx: ActionContext, vm: VmEnv): Promise<ActionOutcome> {
  const tart = tartOf(ctx);
  if (tart === null) return failOutcome('VM の操作は host だけ');
  const r = await ctx.run(tart, ['stop', ctx.cfg.vmNames[vm]], { timeoutMs: 90_000 });
  if (r.code !== 0 && !/not running|is stopped|no running/i.test(r.stderr + r.stdout)) {
    return failOutcome(`tart stop 失敗 (code=${r.code}) ${summarizeOutput(r.stderr)}`);
  }
  return okOutcome('VM を停止した');
}

/** `tart ip` が取れるまで待つ（最大 3 分） */
export async function waitVmIp(
  ctx: ActionContext,
  vm: VmEnv,
  maxMs: number = VM_IP_WAIT_MS,
): Promise<boolean> {
  const tart = tartOf(ctx);
  if (tart === null) return false;
  const deadline = ctx.now() + maxMs;
  while (ctx.now() < deadline) {
    await ctx.sleep(VM_IP_POLL_MS);
    const ip = await tartIp(ctx.run, tart, ctx.cfg.vmNames[vm]);
    if (ip !== undefined) return true;
  }
  return false;
}

/** vm_restart：`tart stop` → launchd の KeepAlive が起動し直す → IP が取れるまで待つ */
export async function vmRestart(ctx: ActionContext, vm: VmEnv): Promise<ActionOutcome> {
  const stopped = await tartStop(ctx, vm);
  if (!stopped.ok) return stopped;
  const up = await waitVmIp(ctx, vm);
  return up
    ? okOutcome(`${vm} を再起動し、IP の取得を確認した`)
    : failOutcome(`${vm} を停止したが 3 分以内に IP を取得できなかった`);
}

/** vm_stop：launchctl disable → bootout → tart stop（自動起動も止める） */
export async function vmStop(ctx: ActionContext, vm: VmEnv): Promise<ActionOutcome> {
  const target = serviceTarget(ctx.cfg.uid, ctx.cfg.labels.vm[vm]);
  const dis = await ctx.run('/bin/launchctl', ['disable', target]);
  if (dis.code !== 0) return failOutcome(`launchctl disable 失敗 (code=${dis.code})`);
  const out = await ctx.run('/bin/launchctl', ['bootout', target], { timeoutMs: 60_000 });
  // 既に読み込まれていない（code 3 / "No such process" 等）は許容
  if (out.code !== 0 && !/no such process|not find|could not/i.test(out.stderr + out.stdout)) {
    return failOutcome(`launchctl bootout 失敗 (code=${out.code})`);
  }
  const stopped = await tartStop(ctx, vm);
  if (!stopped.ok) return stopped;
  return okOutcome(`${vm} を停止し、自動起動も止めた`);
}

/** vm_start：launchctl enable → bootstrap gui/<uid> <plist> */
export async function vmStart(ctx: ActionContext, vm: VmEnv): Promise<ActionOutcome> {
  const target = serviceTarget(ctx.cfg.uid, ctx.cfg.labels.vm[vm]);
  const en = await ctx.run('/bin/launchctl', ['enable', target]);
  if (en.code !== 0) return failOutcome(`launchctl enable 失敗 (code=${en.code})`);
  const boot = await ctx.run(
    '/bin/launchctl',
    ['bootstrap', `gui/${ctx.cfg.uid}`, ctx.cfg.vmPlists[vm]],
    {
      timeoutMs: 60_000,
    },
  );
  if (
    boot.code !== 0 &&
    !/already (loaded|bootstrapped)|service already/i.test(boot.stderr + boot.stdout)
  ) {
    return failOutcome(
      `launchctl bootstrap 失敗 (code=${boot.code}) ${summarizeOutput(boot.stderr)}`,
    );
  }
  const up = await waitVmIp(ctx, vm);
  return up
    ? okOutcome(`${vm} を起動し、IP の取得を確認した`)
    : okOutcome(`${vm} の起動を指示した（3 分以内に IP は取れていない。起動中として扱う）`);
}
