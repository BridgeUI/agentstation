import {
  VM_ENVS,
  parseMembersConfig,
  isHostHeartbeat,
  type Command,
  type CommandAction,
  type Env,
  type Heartbeat,
  type Millis,
  type PlugView,
} from '@agentstation/shared';
import { liveness } from '../api/dashboard.js';
import {
  activeCommand,
  deleteNotifyState,
  expireStaleCommands,
  getPlugStatus,
  latestCommandOf,
  latestHeartbeats,
  listNotifyStates,
  purgeOldRows,
  setNotifyState,
  unnotifiedFinishedCommands,
  type HeartbeatRow,
  type NotifyStateRow,
} from '../db.js';
import type { Bindings } from '../env.js';
import { switchbotConfig } from '../switchbot.js';
import { plugLine, plugStage } from './plug.js';
import {
  dashboardUrl,
  createSlackNotifier,
  envLabel,
  formatDuration,
  formatTime,
  localPart,
  type Notifier,
  type SlackMessage,
} from './slack.js';

/**
 * 1分ごとの監視（docs/spec.md 4.3）。
 * 0. スマートプラグ：電源の入れ直しの指示を進め、プラグの状態を読む（cron/plug.ts。未設定なら何もしない）
 * 1. 期限切れ・放置の指示を expired / failed にし、failed / expired を通知（1件につき1回）
 * 2. 途絶・VM停止・要ログイン・再接続待ち・ディスク・メモリ・プラグを判定し、状態が変わったときだけ通知。復旧も通知
 * 3. 夜間メンテナンスの失敗を通知（last_run_at ごとに1回）
 * 4. 保持期間を過ぎた行を削除
 * 段階ごとに try/catch し、1つが失敗しても他は進める。
 * Slack の本文には環境名・状態・時刻・リンクだけ（worker/src/cron/slack.ts）。
 */

/** VM が stopped のまま、これだけ続いたら通知 */
export const VM_STOPPED_MS = 5 * 60 * 1000;
/** Remote Control が reconnecting のまま、これだけ続いたら通知 */
export const RC_RECONNECT_MS = 15 * 60 * 1000;
/** メモリ使用率がしきい値を超えたまま、これだけ続いたら通知 */
export const MEM_SUSTAIN_MS = 10 * 60 * 1000;
/** 資源のしきい値（worker/src/api/dashboard.ts と同じ値。docs/spec.md 5章） */
export const DISK_WARN_PCT = 85;
export const DISK_ERROR_PCT = 90;
export const MEM_ERROR_PCT = 90;
/** プラグがオフのまま、これだけ続いたら通知（入れ直しの最中は除く） */
export const PLUG_OFF_MS = 2 * 60 * 1000;
/** host は生きているのにプラグに届かない状態が、これだけ続いたら通知（最後の復旧手段が使えない） */
export const PLUG_UNREACHABLE_MS = 15 * 60 * 1000;

/** notify_state.state の値。'observing' はまだ通知していない（継続時間を測っている）状態 */
const OBSERVING = 'observing';

export async function runCron(env: Bindings, now: Millis = Date.now()): Promise<void> {
  const notifier = createSlackNotifier(
    env.SLACK_WEBHOOK_URL,
    now,
    env.TZ_DISPLAY,
    dashboardUrl(env.SITE_JSON),
  );
  await stage('スマートプラグ', () => plugStage(env, now));
  await stage('指示の期限切れと結果の通知', () => notifyCommands(env, notifier, now));
  await stage('途絶・資源の判定', () => checkConditions(env, notifier, now));
  await stage('夜間メンテナンスの結果', () => notifyMaintenance(env, notifier));
  await stage('保持期間を過ぎた行の削除', () => purge(env, now));
}

async function stage(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.error(`[cron] ${name} で例外: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ---------- 1. 指示 ----------

const ACTION_LABELS: Record<CommandAction, string> = {
  rc_restart: 'Remote Control の再起動',
  session_restore: 'セッションの復元',
  rc_start_dir: 'フォルダを選んで Remote Control を起動',
  rc_stop_dir: 'フォルダの Remote Control を停止',
  rc_mkdir: 'フォルダを作成',
  rc_permission_set: 'Remote Control の権限モードを変更',
  claude_permission_set: 'Claude Code の既定の権限モードを変更',
  claude_update: 'Claude の更新',
  codex_restart: 'Codex の再起動',
  vm_restart: 'VM の再起動',
  vm_stop: 'VM の停止',
  vm_start: 'VM の起動',
  host_restart: 'ホストの再起動',
  host_power_cycle: 'スマートプラグでの電源の入れ直し',
};

async function notifyCommands(env: Bindings, notifier: Notifier, now: Millis): Promise<void> {
  const r = await expireStaleCommands(env.DB, now);
  if (r.expired || r.timedOut) {
    console.warn(`[cron] 指示を期限切れに: expired=${r.expired} failed(放置)=${r.timedOut}`);
  }
  for (const c of await unnotifiedFinishedCommands(env.DB)) {
    const ok = await notifier.send(commandMessage(c));
    // 送れなかったときは記録しない（次回に再送する）
    if (ok) await setNotifyState(env.DB, `command:${c.id}`, c.status, now);
  }
}

function commandMessage(c: Command): SlackMessage {
  const what = `${envLabel(c.env)} の${ACTION_LABELS[c.action] ?? c.action}`;
  const head = c.status === 'expired' ? '操作が期限切れ' : '操作が失敗';
  const lines = [`依頼: ${localPart(c.requested_by)}`];
  if (c.finished_at)
    lines.push(`${c.status === 'expired' ? '期限' : '終了'}: ${formatTime(c.finished_at)}`);
  // 電源の入れ直しの output は Worker 自身が書いた要約（オフのまま止まっていないか、手でオンにすべきか）なので載せる
  if (c.action === 'host_power_cycle' && c.output) lines.push(c.output);
  return { title: `${head}: ${what}`, lines, env: c.env, kind: 'alert' };
}

// ---------- 2. 途絶・資源 ----------

interface Condition {
  env: Env;
  /** 障害が始まった時刻が分かるとき（最終受信など）。無ければ初回観測時刻を notify_state で測る */
  since?: Millis;
  /** これだけ続いてから通知する（0 なら即時） */
  afterMs: number;
  /** 通知済みとして記録する状態。変わったら通知し直す（例: ディスクの warn → error） */
  state: string;
  title: string;
  lines?: string[];
}

interface Evaluation {
  /** いま成り立っている条件 */
  desired: Map<string, Condition>;
  /** 判定できたキー。ここに無いキーは状態を触らない（host が止まっていて VM の様子が分からない等） */
  evaluated: Set<string>;
}

async function checkConditions(env: Bindings, notifier: Notifier, now: Millis): Promise<void> {
  const rows = await latestHeartbeats(env.DB);
  const states = await listNotifyStates(env.DB);
  const plug = switchbotConfig(env) ? await getPlugStatus(env.DB) : null;
  const enabled = parseMembersConfig(env.MEMBERS_JSON).enabled;
  const { desired, evaluated } = await evaluate(env.DB, rows, now, plug, enabled);

  for (const key of evaluated) {
    const cond = desired.get(key);
    const stored = states.get(key);
    if (cond) {
      const since = cond.since ?? stored?.updated_at ?? now;
      if (now - since < cond.afterMs) {
        // まだ通知しない。初回観測時刻だけ残す
        if (!stored) await setNotifyState(env.DB, key, OBSERVING, since);
        continue;
      }
      if (stored?.state === cond.state) continue;
      const ok = await notifier.send({
        title: cond.title,
        lines: cond.lines,
        env: cond.env,
        kind: 'alert',
      });
      if (ok) await setNotifyState(env.DB, key, cond.state, since);
    } else if (stored) {
      await recover(env, notifier, key, stored, now);
    }
  }
}

async function recover(
  env: Bindings,
  notifier: Notifier,
  key: string,
  stored: NotifyStateRow,
  now: Millis,
): Promise<void> {
  if (!stored.state || stored.state === OBSERVING) {
    await deleteNotifyState(env.DB, key);
    return;
  }
  const [kind, e] = key.split(':') as [string, Env];
  const dur = stored.updated_at ? formatDuration(now - stored.updated_at) : '不明';
  const r = RECOVER_TITLES[kind]?.(e) ?? { title: `${key} が復旧`, word: '継続' };
  const ok = await notifier.send({
    title: `復旧: ${r.title}（${r.word} ${dur}）`,
    env: e,
    kind: 'recover',
  });
  if (ok) await deleteNotifyState(env.DB, key);
}

const RECOVER_TITLES: Record<string, (e: Env) => { title: string; word: string }> = {
  outage: () => ({ title: 'Mac が応答', word: '停止' }),
  agent: (e) => ({ title: `${e} のエージェントが応答`, word: '停止' }),
  vm_stopped: (e) => ({ title: `${e} が起動`, word: '停止' }),
  rc_login: (e) => ({ title: `${envLabel(e)} の再ログインが完了`, word: '継続' }),
  rc_reconnect: (e) => ({ title: `${envLabel(e)} の Remote Control が接続`, word: '継続' }),
  disk: () => ({ title: 'ディスクの残量が回復', word: '継続' }),
  mem: () => ({ title: 'メモリの逼迫が解消', word: '継続' }),
  plug_off: () => ({ title: 'スマートプラグがオン', word: 'オフ' }),
  plug_unreachable: () => ({ title: 'スマートプラグに届くようになった', word: '継続' }),
};

async function evaluate(
  db: D1Database,
  rows: Map<Env, HeartbeatRow>,
  now: Millis,
  plug: PlugView | null = null,
  enabled: readonly Env[] = ['host', ...VM_ENVS],
): Promise<Evaluation> {
  const desired = new Map<string, Condition>();
  const evaluated = new Set<string>();

  // スマートプラグがオフ（docs/spec.md 6.1）。host の報告とは独立に見る。入れ直しの最中（オフ→オン）は除く
  if (plug?.ok) {
    evaluated.add('plug_off:host');
    if (plug.state === 'off' && !(await powerCycleInProgress(db))) {
      desired.set('plug_off:host', {
        env: 'host',
        afterMs: PLUG_OFF_MS,
        state: 'alerting',
        title: 'スマートプラグがオフ（Mac に電源が来ていない）',
        lines: ['ダッシュボードの「電源を入れ直す」か、SwitchBot アプリでオンにする'],
      });
    }
  }

  const hostRow = rows.get('host');
  // まだ一度も報告が無い（導入前）なら何も判定しない
  if (!hostRow) return { desired, evaluated };

  evaluated.add('outage:host');
  if (liveness(hostRow.received_at, now) === 'unresponsive') {
    const lines = [`最終受信: ${formatTime(hostRow.received_at)}`];
    // プラグの様子で「回線」「電源」「エージェント」のどれらしいかを添える
    const pl = plugLine(plug);
    if (pl) lines.push(pl);
    desired.set('outage:host', {
      env: 'host',
      since: hostRow.received_at,
      afterMs: 0,
      state: 'alerting',
      title: 'Mac 応答なし',
      lines,
    });
    // host が止まっている間は他の様子が分からないので、他のキーは触らない
    return { desired, evaluated };
  }
  // host は生きているのにプラグに届かない → 最後の復旧手段が使えない状態（プラグの Wi‑Fi などを疑う）
  if (plug) {
    evaluated.add('plug_unreachable:host');
    if (!plug.ok) {
      desired.set('plug_unreachable:host', {
        env: 'host',
        afterMs: PLUG_UNREACHABLE_MS,
        state: 'alerting',
        title: 'スマートプラグに届かない（Mac は動いている）',
        lines: [plug.error ?? '', 'プラグの Wi‑Fi と SwitchBot の token を確認する'].filter(
          Boolean,
        ),
      });
    }
  }
  const hostHb = isHostHeartbeat(hostRow.payload) ? hostRow.payload : null;
  if (!hostHb) return { desired, evaluated };

  // 資源（host 全体）
  const disk = pct(hostHb.host.disk_used_gb, hostHb.host.disk_total_gb);
  if (disk !== null) {
    evaluated.add('disk:host');
    if (disk >= DISK_WARN_PCT) {
      const error = disk >= DISK_ERROR_PCT;
      desired.set('disk:host', {
        env: 'host',
        afterMs: 0,
        state: error ? 'error' : 'warn',
        title: `ディスクが残り少ない（${disk}% 使用${error ? '・異常' : '・注意'}）`,
      });
    }
  }
  const mem = pct(hostHb.host.mem_used_gb, hostHb.host.mem_total_gb);
  if (mem !== null) {
    evaluated.add('mem:host');
    if (mem >= MEM_ERROR_PCT) {
      desired.set('mem:host', {
        env: 'host',
        afterMs: MEM_SUSTAIN_MS,
        state: 'alerting',
        title: `メモリ逼迫（${mem}% 使用が10分以上続いている）`,
      });
    }
  }

  // host 自身の Remote Control
  rcConditions('host', hostRow.payload, desired, evaluated);

  // 使っている VM だけ（MEMBERS_JSON.envs に書いたもの）
  for (const vm of VM_ENVS) {
    if (!enabled.includes(vm)) continue;
    const view = hostHb.vms.find((v) => v.env === vm);
    const vmRow = rows.get(vm);
    if (view) {
      evaluated.add(`vm_stopped:${vm}`);
      if (view.vm_state === 'stopped' && !(await intentionallyStopped(db, vm))) {
        desired.set(`vm_stopped:${vm}`, {
          env: vm,
          afterMs: VM_STOPPED_MS,
          state: 'alerting',
          title: `${vm} が停止（5分以上）`,
        });
      }
      // VM のエージェントだけ途絶（host は running と報告）。一度も報告が無い VM は判定しない
      if (view.vm_state === 'running' && vmRow) {
        evaluated.add(`agent:${vm}`);
        if (liveness(vmRow.received_at, now) === 'unresponsive') {
          desired.set(`agent:${vm}`, {
            env: vm,
            since: vmRow.received_at,
            afterMs: 0,
            state: 'alerting',
            title: `${vm} のエージェントが応答なし`,
            lines: [`最終受信: ${formatTime(vmRow.received_at)}`],
          });
        }
      }
    }
    // Remote Control の状態は、その VM のエージェントが生きているときだけ信用する
    if (vmRow && liveness(vmRow.received_at, now) !== 'unresponsive') {
      rcConditions(vm, vmRow.payload, desired, evaluated);
    }
  }
  return { desired, evaluated };
}

function rcConditions(
  env: Env,
  hb: Heartbeat,
  desired: Map<string, Condition>,
  evaluated: Set<string>,
): void {
  const rc = hb.claude.rc_state;
  // unknown は判定しない（状態を触らない）
  if (rc === 'unknown') return;
  evaluated.add(`rc_login:${env}`);
  if (rc === 'login_required') {
    desired.set(`rc_login:${env}`, {
      env,
      afterMs: 0,
      state: 'alerting',
      title: `${envLabel(env)} は再ログインが必要`,
    });
    // 要ログインの間は「再接続待ち」の判定を保留する
    return;
  }
  evaluated.add(`rc_reconnect:${env}`);
  if (rc === 'reconnecting') {
    desired.set(`rc_reconnect:${env}`, {
      env,
      afterMs: RC_RECONNECT_MS,
      state: 'alerting',
      title: `${envLabel(env)} の Remote Control がつながらない（再接続待ちが15分以上）`,
    });
  }
}

/** 電源の入れ直し（host_power_cycle）が queued / running なら、プラグのオフは意図したもの */
async function powerCycleInProgress(db: D1Database): Promise<boolean> {
  const c = await activeCommand(db, 'host');
  return c?.action === 'host_power_cycle';
}

/** 直近の VM 操作が vm_stop（done か実行中）なら、停止は意図したもの */
async function intentionallyStopped(db: D1Database, vm: Env): Promise<boolean> {
  const c = await latestCommandOf(db, vm, ['vm_stop', 'vm_start', 'vm_restart']);
  return (
    c?.action === 'vm_stop' &&
    (c.status === 'done' || c.status === 'queued' || c.status === 'running')
  );
}

function pct(used: number | undefined, total: number | undefined): number | null {
  if (used === undefined || total === undefined || total <= 0) return null;
  return Math.round((used / total) * 100);
}

// ---------- 3. 夜間メンテナンス ----------

async function notifyMaintenance(env: Bindings, notifier: Notifier): Promise<void> {
  const rows = await latestHeartbeats(env.DB);
  const states = await listNotifyStates(env.DB);
  for (const row of rows.values()) {
    const m = row.payload.maintenance;
    if (m?.last_result !== 'failed') continue;
    const key = `maint:${row.env}`;
    const state = String(m.last_run_at ?? 'unknown');
    if (states.get(key)?.state === state) continue;
    const ok = await notifier.send({
      title: `${envLabel(row.env)} の夜間メンテナンスが失敗`,
      lines: m.last_run_at ? [`実行: ${formatTime(m.last_run_at)}`] : undefined,
      env: row.env,
      kind: 'alert',
    });
    if (ok) await setNotifyState(env.DB, key, state, m.last_run_at ?? 0);
  }
}

// ---------- 4. 掃除 ----------

async function purge(env: Bindings, now: Millis): Promise<void> {
  const c = await purgeOldRows(env.DB, now);
  const total = Object.values(c).reduce((a, b) => a + b, 0);
  if (total > 0) console.warn(`[cron] 保持期間を過ぎた行を削除: ${JSON.stringify(c)}`);
}
