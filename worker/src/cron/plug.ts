import { CLOUD_EXECUTOR, type Millis, type PlugView } from '@macmini/shared';
import {
  audit,
  claimCommands,
  finishCommand,
  noteCommandProgress,
  runningCommandsOf,
  savePlugStatus,
} from '../db.js';
import type { Bindings } from '../env.js';
import {
  SwitchBotError,
  readPlug,
  sendPlugCommand,
  switchbotConfig,
  type SwitchBotConfig,
} from '../switchbot.js';

/**
 * スマートプラグ（docs/spec.md 6.1）。1 分ごとの Cron から呼ぶ。
 * 1. 'cloud' 宛の指示（host_power_cycle）を進める：queued → オフ（running）→ 次の回でオン → done
 * 2. プラグの状態（オン/オフ・消費電力）を読んで plug_status に置く
 * エージェントは関与しない。host が死んでいるときに使う機能なので、Mac 側に何も求めない。
 * 失敗の通知は指示の failed を通知する既存の段階（cron/index.ts）に任せる。
 */

/** オフにしてからオンにするまで、最低これだけ待つ（Cron が 1 分ごとなので実際は約 1 分） */
export const PLUG_OFF_WAIT_MS = 30 * 1000;
/** オンが失敗し続けたら、これで諦めて failed にする（アプリで手でオンにしてもらう） */
export const PLUG_ON_DEADLINE_MS = 5 * 60 * 1000;
/** 監査ログの actor（人でもエージェントでもなく Worker） */
export const PLUG_ACTOR = 'worker:plug';
export const MANUAL_ON_HINT = 'SwitchBot アプリで手動でオンにしてください';

export async function plugStage(env: Bindings, now: Millis): Promise<void> {
  const cfg = switchbotConfig(env);
  if (!cfg) return;
  await advancePowerCycle(env, cfg, now);
  const view = await readPlug(cfg, now);
  await savePlugStatus(env.DB, view);
}

async function advancePowerCycle(env: Bindings, cfg: SwitchBotConfig, now: Millis): Promise<void> {
  const db = env.DB;
  // 1. 前の回でオフにした指示の続き（オン）。受領より先にやる（同じ回でオフ→オンにしない）
  for (const c of await runningCommandsOf(db, CLOUD_EXECUTOR)) {
    if (c.action !== 'host_power_cycle') {
      await finishCommand(db, c.id, CLOUD_EXECUTOR, 'failed', 'Worker が実行できない action', now);
      await audit(db, PLUG_ACTOR, 'command.failed', c.env, c.action, now);
      continue;
    }
    const offAt = c.started_at ?? c.created_at;
    if (now - offAt < PLUG_OFF_WAIT_MS) continue;
    try {
      await sendPlugCommand(cfg, 'turnOn', now);
      await finishCommand(
        db,
        c.id,
        CLOUD_EXECUTOR,
        'done',
        'オフ → オンまで完了。3〜5 分で報告が戻るのを待つ',
        now,
      );
      await audit(db, PLUG_ACTOR, 'command.done', c.env, c.action, now);
    } catch (e) {
      const why = reason(e);
      if (now - offAt >= PLUG_ON_DEADLINE_MS) {
        await finishCommand(
          db,
          c.id,
          CLOUD_EXECUTOR,
          'failed',
          `オフにしたあと、オンに失敗が続いた（${why}）。${MANUAL_ON_HINT}`,
          now,
        );
        await audit(db, PLUG_ACTOR, 'command.failed', c.env, c.action, now);
      } else {
        await noteCommandProgress(db, c.id, `オフ済み。オンに失敗（${why}）。次の回に再試行`);
      }
    }
  }
  // 2. 新しい指示の受領 → オフ
  for (const c of await claimCommands(db, CLOUD_EXECUTOR, now)) {
    await audit(db, PLUG_ACTOR, 'command.running', c.env, c.action, now);
    if (c.action !== 'host_power_cycle') {
      await finishCommand(db, c.id, CLOUD_EXECUTOR, 'failed', 'Worker が実行できない action', now);
      await audit(db, PLUG_ACTOR, 'command.failed', c.env, c.action, now);
      continue;
    }
    try {
      await sendPlugCommand(cfg, 'turnOff', now);
      await noteCommandProgress(db, c.id, 'オフにした。約 1 分後にオンにする');
    } catch (e) {
      // オフにできていないので Mac はそのまま。failed にして通知に任せる
      await finishCommand(db, c.id, CLOUD_EXECUTOR, 'failed', `オフに失敗（${reason(e)}）`, now);
      await audit(db, PLUG_ACTOR, 'command.failed', c.env, c.action, now);
    }
  }
}

function reason(e: unknown): string {
  return e instanceof SwitchBotError ? e.message : 'SwitchBot API で不明なエラー';
}

/** Slack やバナーに添える 1 行。null なら何も書かない */
export function plugLine(p: PlugView | null): string | null {
  if (!p) return null;
  if (!p.ok) return '電源プラグ: 届かない（自宅の回線かルーターが落ちている可能性）';
  if (p.state === 'off') return '電源プラグ: オフ（Mac mini に電源が来ていない）';
  if (p.state === 'on' && p.watts !== null) {
    return p.watts < PLUG_OFF_LIKE_W
      ? `電源プラグ: オン・${p.watts}W（消費電力がほぼ 0。Mac が落ちている可能性）`
      : `電源プラグ: オン・${p.watts}W（通電あり。エージェントか macOS 側の問題の可能性）`;
  }
  return p.state === 'on' ? '電源プラグ: オン' : '電源プラグ: 状態不明';
}

/** これ未満の W なら「ほぼ 0」。Mac mini のアイドルは実測 2〜4 W（2026-11-01）、電源が落ちていれば 1 W を大きく下回る */
export const PLUG_OFF_LIKE_W = 1;
