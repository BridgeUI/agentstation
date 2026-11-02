import type { MaintenanceResult, PeerSummary, VmEnv } from '@agentstation/shared';
import type { ActionContext } from '../actions/context.js';
import { claudeUpdate } from '../actions/rc.js';
import { vmRestart } from '../actions/vm.js';
import { isBusy, type BusyMaterials } from '../collect/rclog.js';
import { jstParts } from '../time.js';
import { decideVmRestart, type MaintenanceTask } from './schedule.js';

/** 夜間メンテナンスの実行（docs/spec.md 7章）。判定は schedule.ts、操作は actions/ を使う */

export interface MaintenanceDeps {
  ctx: ActionContext;
  /** 作業中判定の材料を集める（collect 側の最新値） */
  busyMaterials: () => BusyMaterials;
  /** host だけ：直近のハートビート応答の peers */
  peers: () => Partial<Record<VmEnv, PeerSummary>>;
}

export async function runMaintenanceTask(
  task: MaintenanceTask,
  deps: MaintenanceDeps,
): Promise<void> {
  const { ctx } = deps;
  const now = ctx.now();
  ctx.state.maintenance_runs[task.key] = jstParts(now).date;
  ctx.saveState();

  if (task.kind === 'self_update') {
    const result = await selfUpdate(deps);
    ctx.state.maintenance = { last_run_at: now, last_result: result };
    ctx.saveState();
    ctx.log.info('夜間メンテナンス（自分の更新）', { result });
    return;
  }

  const vm = task.vm;
  if (!vm) return;
  const decision = decideVmRestart(deps.peers()[vm], now);
  if (!decision.restart) {
    ctx.log.info('夜間メンテナンス（VM 再起動）を見送り', { vm, reason: decision.reason });
    return;
  }
  const r = await vmRestart(ctx, vm);
  if (r.ok) {
    ctx.log.info('夜間メンテナンス（VM 再起動）', { vm, reason: decision.reason });
    return;
  }
  // だめなら 1 回立て直し（docs/spec.md 7章「2.」）。それでもだめなら Cron 側が途絶で通知する
  const again = await vmRestart(ctx, vm);
  ctx.log[again.ok ? 'warn' : 'error']('夜間メンテナンス（VM 再起動）を再試行', {
    vm,
    ok: again.ok,
  });
}

async function selfUpdate(deps: MaintenanceDeps): Promise<MaintenanceResult> {
  if (isBusy(deps.busyMaterials())) return 'busy';
  const r = await claudeUpdate(deps.ctx);
  if (r.ok) return 'updated';
  deps.ctx.log.warn('夜間メンテナンスの更新に失敗。1 回立て直す', { summary: r.summary });
  const again = await claudeUpdate(deps.ctx);
  return again.ok ? 'updated' : 'failed';
}
