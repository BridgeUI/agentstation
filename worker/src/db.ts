import {
  SESSION_TITLE_MAX,
  WINDOWED_ACTIONS,
  type Command,
  type CommandAction,
  type CommandArgs,
  type CommandStatus,
  type Env,
  type Executor,
  type Heartbeat,
  type Millis,
  type PlugView,
  type SessionInfo,
} from '@agentstation/shared';
import type { AuditEntry, SessionRow } from '@agentstation/shared';

/** D1 のクエリ層。時刻はすべて unix ミリ秒。秘密情報・会話内容・パスは入れない。 */

/** heartbeat_history に残す間隔（5分に1回） */
export const HISTORY_INTERVAL_MS = 5 * 60 * 1000;
/** sessions の保持（last_seen から7日） */
export const SESSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/** running のまま放置された指示を failed にするまで */
export const RUNNING_TIMEOUT_MS = 30 * 60 * 1000;
/** host_restart / host_power_cycle は登録から15分以内の最新の指示だけ実行する */
export const HOST_RESTART_WINDOW_MS = 15 * 60 * 1000;
/** output（結果の要約）の上限 */
export const OUTPUT_MAX = 500;

// ---------- heartbeats ----------

export interface HeartbeatRow {
  env: Env;
  received_at: Millis;
  payload: Heartbeat;
}

/** sessions を除いた payload を最新状態として保存し、5分に1回だけ履歴にも残す */
export async function saveHeartbeat(
  db: D1Database,
  env: Env,
  hb: Heartbeat,
  now: Millis,
): Promise<void> {
  const stored: Heartbeat = { ...hb, sessions: [] };
  const payload = JSON.stringify(stored);
  const last = await db
    .prepare('SELECT MAX(received_at) AS t FROM heartbeat_history WHERE env = ?')
    .bind(env)
    .first<{ t: number | null }>();
  const stmts = [
    db
      .prepare(
        'INSERT INTO heartbeats (env, received_at, payload) VALUES (?, ?, ?) ' +
          'ON CONFLICT(env) DO UPDATE SET received_at = excluded.received_at, payload = excluded.payload',
      )
      .bind(env, now, payload),
  ];
  if (!last?.t || now - last.t >= HISTORY_INTERVAL_MS) {
    stmts.push(
      db
        .prepare(
          'INSERT OR REPLACE INTO heartbeat_history (env, received_at, payload) VALUES (?, ?, ?)',
        )
        .bind(env, now, payload),
    );
  }
  await db.batch(stmts);
}

export async function latestHeartbeats(db: D1Database): Promise<Map<Env, HeartbeatRow>> {
  const { results } = await db
    .prepare('SELECT env, received_at, payload FROM heartbeats')
    .all<{ env: Env; received_at: number; payload: string }>();
  const map = new Map<Env, HeartbeatRow>();
  for (const r of results) {
    map.set(r.env, {
      env: r.env,
      received_at: r.received_at,
      payload: JSON.parse(r.payload) as Heartbeat,
    });
  }
  return map;
}

// ---------- sessions ----------

export async function upsertSessions(
  db: D1Database,
  env: Env,
  sessions: SessionInfo[],
  now: Millis,
): Promise<void> {
  if (sessions.length === 0) return;
  const stmts = sessions
    .slice(0, 50)
    .map((s) =>
      db
        .prepare(
          'INSERT INTO sessions (env, session_id, title, started_at, last_seen) VALUES (?, ?, ?, ?, ?) ' +
            'ON CONFLICT(env, session_id) DO UPDATE SET title = excluded.title, started_at = COALESCE(sessions.started_at, excluded.started_at), last_seen = excluded.last_seen',
        )
        .bind(
          env,
          s.id,
          s.title ? s.title.slice(0, SESSION_TITLE_MAX) : null,
          s.started_at ?? null,
          now,
        ),
    );
  await db.batch(stmts);
}

export async function listSessions(db: D1Database, env: Env, now: Millis): Promise<SessionRow[]> {
  const { results } = await db
    .prepare(
      'SELECT env, session_id, title, started_at, last_seen FROM sessions WHERE env = ? AND last_seen > ? ORDER BY last_seen DESC LIMIT 50',
    )
    .bind(env, now - SESSION_RETENTION_MS)
    .all<SessionRow>();
  return results;
}

// ---------- commands ----------

interface CommandDbRow {
  id: string;
  env: Env;
  executor: Executor;
  action: CommandAction;
  args: string | null;
  status: CommandStatus;
  requested_by: string;
  created_at: number;
  not_before: number | null;
  expires_at: number;
  started_at: number | null;
  finished_at: number | null;
  output: string | null;
}

function toCommand(r: CommandDbRow): Command {
  return { ...r, args: r.args ? (JSON.parse(r.args) as CommandArgs) : null };
}

const COMMAND_COLS =
  'id, env, executor, action, args, status, requested_by, created_at, not_before, expires_at, started_at, finished_at, output';

export async function getCommand(db: D1Database, id: string): Promise<Command | null> {
  const r = await db
    .prepare(`SELECT ${COMMAND_COLS} FROM commands WHERE id = ?`)
    .bind(id)
    .first<CommandDbRow>();
  return r ? toCommand(r) : null;
}

/** 実行担当（executor）に queued / running の指示があるか。報告間隔を速める判断に使う */
export async function hasActiveForExecutor(db: D1Database, executor: Executor): Promise<boolean> {
  const r = await db
    .prepare(
      "SELECT 1 AS x FROM commands WHERE executor = ? AND status IN ('queued','running') LIMIT 1",
    )
    .bind(executor)
    .first<{ x: number }>();
  return r !== null;
}

// ---------- activity（画面が最後に見られた時刻） ----------

export async function touchActivity(db: D1Database, key: string, now: Millis): Promise<void> {
  await db.prepare('INSERT OR REPLACE INTO activity (key, at) VALUES (?, ?)').bind(key, now).run();
}

export async function getActivity(db: D1Database, key: string): Promise<Millis | null> {
  const r = await db
    .prepare('SELECT at FROM activity WHERE key = ?')
    .bind(key)
    .first<{ at: number }>();
  return r ? r.at : null;
}

/** 同じ環境に queued / running の指示があるか（同時に1件まで） */
export async function activeCommand(db: D1Database, env: Env): Promise<Command | null> {
  const r = await db
    .prepare(
      `SELECT ${COMMAND_COLS} FROM commands WHERE env = ? AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(env)
    .first<CommandDbRow>();
  return r ? toCommand(r) : null;
}

export async function insertCommand(db: D1Database, c: Command): Promise<void> {
  await db
    .prepare(
      'INSERT INTO commands (id, env, executor, action, args, status, requested_by, created_at, not_before, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      c.id,
      c.env,
      c.executor,
      c.action,
      c.args ? JSON.stringify(c.args) : null,
      c.status,
      c.requested_by,
      c.created_at,
      c.not_before,
      c.expires_at,
    )
    .run();
}

/** queued → canceled。queued のときだけ成功する */
export async function cancelCommand(db: D1Database, id: string, now: Millis): Promise<boolean> {
  const r = await db
    .prepare(
      "UPDATE commands SET status = 'canceled', finished_at = ? WHERE id = ? AND status = 'queued'",
    )
    .bind(now, id)
    .run();
  return (r.meta.changes ?? 0) > 0;
}

/**
 * 実行担当（エージェント、または Worker 自身 'cloud'）に渡す指示を取り出し、running にする。
 * - not_before を過ぎている、expires_at 前のものだけ
 * - host_restart / host_power_cycle は「host 向けの最新の指示」で「登録から15分以内」のものだけ（docs/spec.md 6章）
 * 同じ指示を2回渡さない（UPDATE … WHERE status='queued' で確定する）。
 */
export async function claimCommands(
  db: D1Database,
  executor: Executor,
  now: Millis,
): Promise<Command[]> {
  const { results } = await db
    .prepare(
      `SELECT ${COMMAND_COLS} FROM commands WHERE executor = ? AND status = 'queued' AND (not_before IS NULL OR not_before <= ?) AND expires_at > ? ORDER BY created_at ASC`,
    )
    .bind(executor, now, now)
    .all<CommandDbRow>();

  const claimed: Command[] = [];
  for (const r of results) {
    if (WINDOWED_ACTIONS.includes(r.action)) {
      const newest = await db
        .prepare("SELECT id FROM commands WHERE env = 'host' ORDER BY created_at DESC LIMIT 1")
        .first<{ id: string }>();
      if (newest?.id !== r.id || now - r.created_at > HOST_RESTART_WINDOW_MS) continue;
    }
    const u = await db
      .prepare(
        "UPDATE commands SET status = 'running', started_at = ? WHERE id = ? AND status = 'queued'",
      )
      .bind(now, r.id)
      .run();
    if ((u.meta.changes ?? 0) > 0)
      claimed.push(toCommand({ ...r, status: 'running', started_at: now }));
  }
  return claimed;
}

/** running → done / failed。実行担当（エージェント、または 'cloud'）からだけ */
export async function finishCommand(
  db: D1Database,
  id: string,
  executor: Executor,
  status: 'done' | 'failed',
  output: string | undefined,
  now: Millis,
): Promise<boolean> {
  const r = await db
    .prepare(
      "UPDATE commands SET status = ?, finished_at = ?, output = ? WHERE id = ? AND executor = ? AND status = 'running'",
    )
    .bind(status, now, output ? output.slice(0, OUTPUT_MAX) : null, id, executor)
    .run();
  return (r.meta.changes ?? 0) > 0;
}

/** 期限切れの queued → expired、放置された running → failed（Cron と、指示の登録時に呼ぶ） */
export async function expireStaleCommands(
  db: D1Database,
  now: Millis,
): Promise<{ expired: number; timedOut: number }> {
  const [a, b] = await db.batch([
    db
      .prepare(
        "UPDATE commands SET status = 'expired', finished_at = ? WHERE status = 'queued' AND expires_at <= ?",
      )
      .bind(now, now),
    db
      .prepare(
        "UPDATE commands SET status = 'failed', finished_at = ?, output = '実行結果が返らないまま30分経過' WHERE status = 'running' AND started_at <= ?",
      )
      .bind(now, now - RUNNING_TIMEOUT_MS),
  ]);
  return { expired: a?.meta.changes ?? 0, timedOut: b?.meta.changes ?? 0 };
}

export async function activeCommandsByEnv(db: D1Database): Promise<Map<Env, Command>> {
  const { results } = await db
    .prepare(
      `SELECT ${COMMAND_COLS} FROM commands WHERE status IN ('queued','running') ORDER BY created_at ASC`,
    )
    .all<CommandDbRow>();
  const map = new Map<Env, Command>();
  for (const r of results) map.set(r.env, toCommand(r));
  return map;
}

/** running の指示の途中経過を output に残す（電源の入れ直しの「オフにした」など）。status は変えない */
export async function noteCommandProgress(
  db: D1Database,
  id: string,
  output: string,
): Promise<void> {
  await db
    .prepare("UPDATE commands SET output = ? WHERE id = ? AND status = 'running'")
    .bind(output.slice(0, OUTPUT_MAX), id)
    .run();
}

/** 実行担当が running で持っている指示（Cron が 'cloud' の続きを進めるのに使う） */
export async function runningCommandsOf(db: D1Database, executor: Executor): Promise<Command[]> {
  const { results } = await db
    .prepare(
      `SELECT ${COMMAND_COLS} FROM commands WHERE executor = ? AND status = 'running' ORDER BY started_at ASC`,
    )
    .bind(executor)
    .all<CommandDbRow>();
  return results.map(toCommand);
}

// ---------- plug_status（スマートプラグ。docs/spec.md 6.1） ----------

const PLUG_KEY = 'host';

export async function savePlugStatus(db: D1Database, p: PlugView): Promise<void> {
  await db
    .prepare(
      'INSERT INTO plug_status (key, checked_at, ok, state, watts, error) VALUES (?, ?, ?, ?, ?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET checked_at = excluded.checked_at, ok = excluded.ok, state = excluded.state, watts = excluded.watts, error = excluded.error',
    )
    .bind(PLUG_KEY, p.checked_at, p.ok ? 1 : 0, p.state, p.watts, p.error)
    .run();
}

export async function getPlugStatus(db: D1Database): Promise<PlugView | null> {
  const r = await db
    .prepare('SELECT checked_at, ok, state, watts, error FROM plug_status WHERE key = ?')
    .bind(PLUG_KEY)
    .first<{
      checked_at: number;
      ok: number;
      state: PlugView['state'];
      watts: number | null;
      error: string | null;
    }>();
  if (!r) return null;
  return {
    checked_at: r.checked_at,
    ok: r.ok === 1,
    state: r.state,
    watts: r.watts,
    error: r.error,
  };
}

// ---------- audit ----------

export async function audit(
  db: D1Database,
  actor: string,
  action: string,
  target: string | null,
  detail: string | null,
  now: Millis,
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO audit_log (at, actor_email, action, target, detail) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(now, actor, action, target, detail)
    .run();
}

export async function listAudit(db: D1Database, limit: number): Promise<AuditEntry[]> {
  const { results } = await db
    .prepare(
      'SELECT id, at, actor_email, action, target, detail FROM audit_log ORDER BY at DESC, id DESC LIMIT ?',
    )
    .bind(limit)
    .all<AuditEntry>();
  return results;
}

// ---------- notify_state（Cron の重複抑制） ----------

export interface NotifyStateRow {
  key: string;
  state: string | null;
  updated_at: number | null;
}

export async function listNotifyStates(db: D1Database): Promise<Map<string, NotifyStateRow>> {
  const { results } = await db
    .prepare('SELECT key, state, updated_at FROM notify_state')
    .all<NotifyStateRow>();
  return new Map(results.map((r) => [r.key, r]));
}

export async function setNotifyState(
  db: D1Database,
  key: string,
  state: string,
  updatedAt: Millis,
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO notify_state (key, state, updated_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at',
    )
    .bind(key, state, updatedAt)
    .run();
}

export async function deleteNotifyState(db: D1Database, key: string): Promise<void> {
  await db.prepare('DELETE FROM notify_state WHERE key = ?').bind(key).run();
}

// ---------- Cron 用のクエリ ----------

/** failed / expired になったのに、まだ通知していない指示（notify_state に command:<id> が無いもの） */
export async function unnotifiedFinishedCommands(db: D1Database, limit = 20): Promise<Command[]> {
  const { results } = await db
    .prepare(
      `SELECT ${COMMAND_COLS} FROM commands c WHERE c.status IN ('failed','expired') ` +
        "AND NOT EXISTS (SELECT 1 FROM notify_state n WHERE n.key = 'command:' || c.id) " +
        'ORDER BY c.finished_at ASC LIMIT ?',
    )
    .bind(limit)
    .all<CommandDbRow>();
  return results.map(toCommand);
}

/** ある環境に対する、指定した action のうち最新の指示（VM の停止が意図的かの判定に使う） */
export async function latestCommandOf(
  db: D1Database,
  env: Env,
  actions: readonly CommandAction[],
): Promise<Command | null> {
  if (actions.length === 0) return null;
  const marks = actions.map(() => '?').join(',');
  const r = await db
    .prepare(
      `SELECT ${COMMAND_COLS} FROM commands WHERE env = ? AND action IN (${marks}) ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(env, ...actions)
    .first<CommandDbRow>();
  return r ? toCommand(r) : null;
}

/** 保持期間（docs/spec.md 4.2） */
export const HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const COMMAND_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
export const AUDIT_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

export interface PurgeCounts {
  heartbeat_history: number;
  commands: number;
  audit_log: number;
  sessions: number;
  notify_state: number;
}

/** 保持期間を過ぎた行を削除する。commands は finished_at 基準、sessions は last_seen 基準 */
export async function purgeOldRows(db: D1Database, now: Millis): Promise<PurgeCounts> {
  const rows = await db.batch([
    db
      .prepare('DELETE FROM heartbeat_history WHERE received_at < ?')
      .bind(now - HISTORY_RETENTION_MS),
    db
      .prepare('DELETE FROM commands WHERE finished_at IS NOT NULL AND finished_at < ?')
      .bind(now - COMMAND_RETENTION_MS),
    db.prepare('DELETE FROM audit_log WHERE at < ?').bind(now - AUDIT_RETENTION_MS),
    db.prepare('DELETE FROM sessions WHERE last_seen < ?').bind(now - SESSION_RETENTION_MS),
    // 指示ごとの通知済み記録は、指示と同じ期間で消す
    db
      .prepare("DELETE FROM notify_state WHERE key LIKE 'command:%' AND updated_at < ?")
      .bind(now - COMMAND_RETENTION_MS),
  ]);
  const n = (i: number) => rows[i]?.meta.changes ?? 0;
  return {
    heartbeat_history: n(0),
    commands: n(1),
    audit_log: n(2),
    sessions: n(3),
    notify_state: n(4),
  };
}
