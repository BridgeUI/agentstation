import {
  FORBIDDEN_PATTERNS,
  isRcDirName,
  isSetupCheckKey,
  isVmEnv,
  type Heartbeat,
  type HeartbeatResponse,
  type HostHeartbeat,
  type PeerSummary,
  type RcDirs,
  type SessionInfo,
  type SetupCheck,
  type VmEnv,
  type VmHeartbeat,
  isEnv,
  pollIntervalFor,
} from '@macmini/shared';
import { authenticateAgent } from '../auth.js';
import {
  audit,
  claimCommands,
  expireStaleCommands,
  finishCommand,
  getActivity,
  getCommand,
  hasActiveForExecutor,
  latestHeartbeats,
  saveHeartbeat,
  upsertSessions,
} from '../db.js';
import type { Bindings } from '../env.js';
import { HttpError, json, num, obj, readJson, str } from '../http.js';

/** エージェント向け API（docs/spec.md 4.1）。認証は環境ごとのサービストークン。 */

const BUSY_WINDOW_MS = 2 * 60 * 60 * 1000;

export async function postHeartbeat(request: Request, env: Bindings): Promise<Response> {
  const agent = await authenticateAgent(request, env);
  const body = await readJson(request);
  const now = Date.now();

  if (body.env !== agent.env) {
    throw new HttpError(
      403,
      `このトークンは ${agent.env} 用。env=${String(body.env)} は報告できない`,
    );
  }
  const hb = parseHeartbeat(body, agent.env);
  rejectSecrets(hb);

  await saveHeartbeat(env.DB, agent.env, hb, now);
  await upsertSessions(env.DB, agent.env, hb.sessions, now);
  const res = await claimAndAdvise(env, agent.env, now);
  if (agent.env === 'host') res.peers = await peers(env, now);
  return json(res);
}

/**
 * 軽い問い合わせ（docs/spec.md 3.6）。状態は保存せず、未実行の指示と次の間隔だけ返す。
 * 画面が見られている・指示が進行中のあいだ、エージェントはこれを 5 秒ごとに呼ぶ。
 */
export async function postPoll(request: Request, env: Bindings): Promise<Response> {
  const agent = await authenticateAgent(request, env);
  const body = await readJson(request);
  if (!isEnv(body.env) || body.env !== agent.env) {
    throw new HttpError(
      403,
      `このトークンは ${agent.env} 用。env=${String(body.env)} では問い合わせできない`,
    );
  }
  return json(await claimAndAdvise(env, agent.env, Date.now()));
}

/** 期限切れを片付け、実行担当がこのエージェントの queued を running にして返す。次の間隔（poll_ms）も付ける */
async function claimAndAdvise(
  env: Bindings,
  agentEnv: Heartbeat['env'],
  now: number,
): Promise<HeartbeatResponse> {
  await expireStaleCommands(env.DB, now);
  const commands = await claimCommands(env.DB, agentEnv, now);
  for (const c of commands) {
    await audit(env.DB, `agent:${agentEnv}`, 'command.running', c.env, c.action, now);
  }
  const hasActive = commands.length > 0 || (await hasActiveForExecutor(env.DB, agentEnv));
  const lastViewAt = await getActivity(env.DB, 'view');
  return { commands, poll_ms: pollIntervalFor({ hasActive, lastViewAt, now }) };
}

export async function postResult(request: Request, env: Bindings): Promise<Response> {
  const agent = await authenticateAgent(request, env);
  const body = await readJson(request);
  const now = Date.now();

  const id = str(body, 'id');
  const status = str(body, 'status');
  const output = str(body, 'output');
  if (!id) throw new HttpError(400, 'id がない');
  if (status !== 'done' && status !== 'failed')
    throw new HttpError(400, 'status は done か failed');
  if (output && FORBIDDEN_PATTERNS.some((p) => p.test(output))) {
    throw new HttpError(400, 'output に秘密情報らしき文字列が含まれている');
  }

  const target = await getCommand(env.DB, id);
  const ok = await finishCommand(env.DB, id, agent.env, status, output, now);
  if (!ok || !target)
    throw new HttpError(409, 'running の指示が見つからない（別の環境の指示、または既に終了）');
  // 監査ログは「対象の環境」と「操作名」で残す（画面の操作履歴に出す）
  await audit(env.DB, `agent:${agent.env}`, `command.${status}`, target.env, target.action, now);
  return json({ ok: true });
}

// ---------- 検証 ----------

function parseHeartbeat(b: Record<string, unknown>, envName: Heartbeat['env']): Heartbeat {
  const agent_version = str(b, 'agent_version');
  const agent_started_at = num(b, 'agent_started_at');
  const sent_at = num(b, 'sent_at');
  const claude = obj(b, 'claude');
  const codex = obj(b, 'codex');
  if (!agent_version || agent_started_at === undefined || sent_at === undefined) {
    throw new HttpError(400, 'agent_version / agent_started_at / sent_at が必要');
  }
  if (!claude || typeof claude.state !== 'string' || typeof claude.rc_state !== 'string') {
    throw new HttpError(400, 'claude.state / claude.rc_state が必要');
  }
  if (!codex || typeof codex.state !== 'string') throw new HttpError(400, 'codex.state が必要');

  const base = {
    agent_version,
    agent_started_at,
    sent_at,
    claude: claude as unknown as Heartbeat['claude'],
    codex: codex as unknown as Heartbeat['codex'],
    sessions: parseSessions(b.sessions),
  };
  const maintenance = obj(b, 'maintenance') as Heartbeat['maintenance'] | undefined;
  const setup = parseSetup(b.setup);
  const rc_dirs = parseRcDirs(b.rc_dirs);

  if (envName === 'host') {
    const host = obj(b, 'host');
    if (!host) throw new HttpError(400, 'host が必要');
    const vms = Array.isArray(b.vms) ? b.vms : [];
    for (const v of vms) {
      if (typeof v !== 'object' || v === null || !isVmEnv((v as Record<string, unknown>).env)) {
        throw new HttpError(400, 'vms の env が不正');
      }
    }
    const h: HostHeartbeat = {
      env: 'host',
      ...base,
      host: host as HostHeartbeat['host'],
      vms: vms as HostHeartbeat['vms'],
    };
    if (maintenance) h.maintenance = maintenance;
    if (setup) h.setup = setup;
    if (rc_dirs) h.rc_dirs = rc_dirs;
    return h;
  }
  const guest = obj(b, 'guest');
  if (!guest) throw new HttpError(400, 'guest が必要');
  const v: VmHeartbeat = { env: envName, ...base, guest: guest as VmHeartbeat['guest'] };
  if (maintenance) v.maintenance = maintenance;
  if (setup) v.setup = setup;
  if (rc_dirs) v.rc_dirs = rc_dirs;
  return v;
}

function parseSessions(x: unknown): SessionInfo[] {
  if (!Array.isArray(x)) return [];
  const out: SessionInfo[] = [];
  for (const s of x.slice(0, 50)) {
    if (typeof s !== 'object' || s === null) continue;
    const r = s as Record<string, unknown>;
    const id = str(r, 'id');
    if (!id) continue;
    const title = str(r, 'title');
    const started_at = num(r, 'started_at');
    out.push({
      id,
      ...(title ? { title } : {}),
      ...(started_at !== undefined ? { started_at } : {}),
    });
  }
  return out;
}

/** 基礎設定のチェック結果。知らないキー・形のものは捨てる。detail は 80 文字まで */
function parseSetup(x: unknown): SetupCheck[] | undefined {
  if (!Array.isArray(x)) return undefined;
  const out: SetupCheck[] = [];
  for (const c of x.slice(0, 64)) {
    if (typeof c !== 'object' || c === null) continue;
    const r = c as Record<string, unknown>;
    const status = str(r, 'status');
    if (!isSetupCheckKey(r.key) || !status || !['ok', 'ng', 'unknown', 'skip'].includes(status))
      continue;
    const detail = str(r, 'detail');
    out.push({
      key: r.key,
      status: status as SetupCheck['status'],
      ...(detail ? { detail: detail.slice(0, 80) } : {}),
    });
  }
  return out;
}

/** フォルダ選択 Remote Control の状態。フォルダ名だけを受け取り、パスらしきものは捨てる */
function parseRcDirs(x: unknown): RcDirs | undefined {
  if (typeof x !== 'object' || x === null) return undefined;
  const r = x as Record<string, unknown>;
  const root = str(r, 'root');
  if (!root || root.includes('/')) return undefined;
  const available = Array.isArray(r.available)
    ? r.available.filter((d) => isRcDirName(d)).slice(0, 100)
    : [];
  const running: RcDirs['running'] = [];
  if (Array.isArray(r.running)) {
    for (const item of r.running.slice(0, 50)) {
      if (typeof item !== 'object' || item === null) continue;
      const o = item as Record<string, unknown>;
      const dir = str(o, 'dir');
      const state = str(o, 'state');
      if (
        !isRcDirName(dir) ||
        !state ||
        !['starting', 'running', 'stopped', 'error'].includes(state)
      )
        continue;
      const name = str(o, 'name');
      const started_at = num(o, 'started_at');
      const detail = str(o, 'detail');
      running.push({
        dir,
        state: state as RcDirs['running'][number]['state'],
        ...(name ? { name: name.slice(0, 80) } : {}),
        ...(started_at !== undefined ? { started_at } : {}),
        ...(detail ? { detail: detail.slice(0, 80) } : {}),
      });
    }
  }
  return { root, available, running };
}

/** パス・メール・トークンらしきものが混ざっていたら受け付けない（CLAUDE.md 3）。セッションのタイトルは対象外。 */
function rejectSecrets(hb: Heartbeat): void {
  const text = JSON.stringify({ ...hb, sessions: undefined });
  if (FORBIDDEN_PATTERNS.some((p) => p.test(text))) {
    throw new HttpError(
      400,
      'ハートビートに秘密情報らしき文字列（パス・メール・トークン）が含まれている',
    );
  }
}

async function peers(env: Bindings, now: number): Promise<Partial<Record<VmEnv, PeerSummary>>> {
  const rows = await latestHeartbeats(env.DB);
  const out: Partial<Record<VmEnv, PeerSummary>> = {};
  for (const e of ['vm1', 'vm2'] as const) {
    const r = rows.get(e);
    if (!r) continue;
    const m = r.payload.maintenance;
    const busy =
      m?.last_result === 'busy' &&
      m.last_run_at !== undefined &&
      now - m.last_run_at < BUSY_WINDOW_MS;
    out[e] = { received_at: r.received_at, ...(m ? { maintenance: m } : {}), busy };
  }
  return out;
}
