import {
  COMMAND_SPECS,
  LIVENESS_DELAYED_MS,
  LIVENESS_UNRESPONSIVE_MS,
  canOperate,
  executorFor,
  isCommandAction,
  isEnv,
  isHostHeartbeat,
  isRcDirName,
  isRcPermissionMode,
  isVmEnv,
  parseMembersConfig,
  summarizeSetup,
  type Command,
  type CommandArgs,
  type Env,
  type EnvStatus,
  type Identity,
  type Liveness,
  type Millis,
  type SetupCheck,
  type StatusAlert,
  type StatusResponse,
  type VmView,
} from '@macmini/shared';
import { authenticateUser } from '../auth.js';
import {
  activeCommand,
  activeCommandsByEnv,
  touchActivity,
  audit,
  cancelCommand,
  expireStaleCommands,
  getCommand,
  getPlugStatus,
  insertCommand,
  latestHeartbeats,
  listAudit,
  listSessions,
} from '../db.js';
import type { Bindings } from '../env.js';
import { HttpError, json, obj, readJson, str } from '../http.js';
import { switchbotConfig } from '../switchbot.js';

/** 画面向け API（docs/spec.md 4.1）。認証は Access JWT、権限はここで判定する。 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DISK_WARN = 85;
const DISK_ERROR = 90;
const MEM_WARN = 85;
const MEM_ERROR = 90;

export async function getMe(request: Request, env: Bindings): Promise<Response> {
  const me = await authenticateUser(request, env);
  return json(me);
}

/** 画面が見られている印の書き込みは isolate ごとに 20 秒に 1 回まで（D1 の書き込みを抑える） */
const VIEW_TOUCH_MIN_MS = 20 * 1000;
let lastViewTouch = 0;

export async function getStatus(request: Request, env: Bindings): Promise<Response> {
  await authenticateUser(request, env);
  const now = Date.now();
  // 画面が見られているあいだはエージェントの報告間隔を速める（docs/spec.md 3.6）
  if (now - lastViewTouch >= VIEW_TOUCH_MIN_MS) {
    lastViewTouch = now;
    await touchActivity(env.DB, 'view', now);
  }
  const rows = await latestHeartbeats(env.DB);
  const active = await activeCommandsByEnv(env.DB);

  const hostRow = rows.get('host') ?? null;
  const hostLive = liveness(hostRow?.received_at ?? null, now);
  const hostHb = hostRow && isHostHeartbeat(hostRow.payload) ? hostRow.payload : null;
  const members = parseMembersConfig(env.MEMBERS_JSON);

  // 使っている環境だけ（MEMBERS_JSON.envs に書いた VM。0〜2 台）
  const envs: EnvStatus[] = members.enabled.map((e) => {
    const row = rows.get(e) ?? null;
    let live = liveness(row?.received_at ?? null, now);
    let vm_view: VmView | null = null;
    if (isVmEnv(e)) {
      vm_view = hostHb?.vms.find((v) => v.env === e) ?? null;
      // host の報告が途絶えたら全環境「応答なし」（docs/spec.md 5章）
      if (hostLive === 'unresponsive') live = 'unresponsive';
    }
    const heartbeat = row?.payload ?? null;
    if (heartbeat?.setup)
      heartbeat.setup = resolveUserNameCheck(heartbeat.setup, members.envs[e] ?? '');
    return {
      env: e,
      agent_received_at: row?.received_at ?? null,
      liveness: live,
      heartbeat,
      vm_view,
      active: active.get(e) ?? null,
    };
  });

  const alerts: StatusAlert[] = [];
  if (hostLive === 'unresponsive')
    alerts.push({ level: 'error', message: 'Mac mini が応答していません' });
  else if (hostLive === 'delayed')
    alerts.push({ level: 'warn', message: 'Mac mini からの報告が遅れています' });
  else if (hostLive === 'unknown')
    alerts.push({ level: 'warn', message: 'まだ報告を受け取っていません' });
  if (hostHb) {
    const { disk_used_gb, disk_total_gb, mem_used_gb, mem_total_gb } = hostHb.host;
    const disk = pct(disk_used_gb, disk_total_gb);
    if (disk !== null && disk >= DISK_ERROR)
      alerts.push({ level: 'error', message: `ディスクの残りが少ない（${disk}% 使用）` });
    else if (disk !== null && disk >= DISK_WARN)
      alerts.push({ level: 'warn', message: `ディスクの残りが少なくなってきた（${disk}% 使用）` });
    const mem = pct(mem_used_gb, mem_total_gb);
    if (mem !== null && mem >= MEM_ERROR)
      alerts.push({ level: 'error', message: `メモリが逼迫している（${mem}% 使用）` });
    else if (mem !== null && mem >= MEM_WARN)
      alerts.push({ level: 'warn', message: `メモリの使用率が高い（${mem}% 使用）` });
  }

  // 基礎設定（docs/spec.md 3.2）の未完了。手動の項目は特に目立たせる
  for (const s of envs) {
    if (!s.heartbeat?.setup) continue;
    const sum = summarizeSetup(s.heartbeat.setup);
    if (sum.manualNg.length > 0) {
      alerts.push({
        level: 'warn',
        message: `${s.env}: 手動の基礎設定が ${sum.manualNg.length} 件未完了`,
      });
    } else if (sum.ng > 0) {
      alerts.push({ level: 'warn', message: `${s.env}: 基礎設定が ${sum.ng} 件未完了` });
    }
  }

  // スマートプラグ（docs/spec.md 6.1）。設定済みのときだけ。オフなら全員に見える警告にする（電源が来ていない）
  const plug_enabled = switchbotConfig(env) !== null;
  const plug = plug_enabled ? await getPlugStatus(env.DB) : null;
  if (
    plug?.ok &&
    plug.state === 'off' &&
    (active.get('host')?.action ?? null) !== 'host_power_cycle'
  )
    alerts.push({ level: 'error', message: 'スマートプラグがオフ（Mac mini に電源が来ていない）' });

  const res: StatusResponse = {
    now,
    host_received_at: hostRow?.received_at ?? null,
    envs,
    alerts,
    plug_enabled,
    plug,
  };
  return json(res);
}

/** user.name はエージェントがユーザー名を detail に入れて unknown で送る。メールの @ 前と比べてここで判定する。 */
function resolveUserNameCheck(setup: SetupCheck[], email: string): SetupCheck[] {
  const expected = email.split('@')[0]?.toLowerCase() ?? '';
  return setup.map((c) => {
    if (c.key !== 'user.name' || !c.detail) return c;
    const ok = c.detail.toLowerCase() === expected;
    return {
      ...c,
      status: ok ? 'ok' : 'ng',
      detail: ok ? c.detail : `${c.detail}（期待: ${expected}）`,
    };
  });
}

export async function postCommand(request: Request, env: Bindings): Promise<Response> {
  const me = await authenticateUser(request, env);
  const body = await readJson(request);
  const now = Date.now();

  const id = str(body, 'id');
  const target = body.env;
  const action = body.action;
  if (!id || !UUID_RE.test(id)) throw new HttpError(400, 'id は UUID');
  if (!isEnv(target)) throw new HttpError(400, 'env が不正');
  if (!me.enabled_envs.includes(target))
    throw new HttpError(400, `${target} はこの導入で使っていない`);
  if (!isCommandAction(action)) throw new HttpError(400, 'action がホワイトリストにない');

  const spec = COMMAND_SPECS[action];
  if (!spec.targets.includes(target))
    throw new HttpError(400, `${action} は ${target} に対して実行できない`);
  // 権限の判定（CLAUDE.md 4）。閲覧者と他人の環境は 403
  if (spec.ownerOnly && me.role !== 'owner')
    throw new HttpError(403, 'オーナーだけが実行できる操作');
  if (!canOperate(me, target)) throw new HttpError(403, 'この環境を操作する権限がない');
  if (spec.confirm === 2 && str(body, 'confirm_text') !== 'host') {
    throw new HttpError(400, 'ホスト名（host）の入力が必要');
  }
  if (action === 'host_power_cycle') await checkPowerCycleAllowed(env, now);
  const args = parseArgs(action, obj(body, 'args'));

  // 同じ id の再送は、登録済みの内容をそのまま返す（二重送信防止）
  const existing = await getCommand(env.DB, id);
  if (existing) {
    if (existing.requested_by !== me.email)
      throw new HttpError(409, '同じ id の指示が別の人から登録されている');
    return json(existing, 200);
  }

  await expireStaleCommands(env.DB, now);
  const busy = await activeCommand(env.DB, target);
  if (busy) throw new HttpError(409, `この環境には実行中の指示がある（${busy.action}）`);

  const not_before = spec.graceMs ? now + spec.graceMs : null;
  const c: Command = {
    id,
    env: target,
    executor: executorFor(action, target),
    action,
    args,
    status: 'queued',
    requested_by: me.email,
    created_at: now,
    not_before,
    expires_at: (not_before ?? now) + spec.ttlMs,
    started_at: null,
    finished_at: null,
    output: null,
  };
  await insertCommand(env.DB, c);
  await audit(env.DB, me.email, 'command.create', target, action, now);
  return json(c, 201);
}

export async function postCancel(request: Request, env: Bindings, id: string): Promise<Response> {
  const me = await authenticateUser(request, env);
  const now = Date.now();
  const c = await getCommand(env.DB, id);
  if (!c) throw new HttpError(404, '指示が見つからない');
  if (!canOperate(me, c.env)) throw new HttpError(403, 'この環境を操作する権限がない');
  const ok = await cancelCommand(env.DB, id, now);
  if (!ok) throw new HttpError(409, `queued のときだけ取り消せる（今は ${c.status}）`);
  await audit(env.DB, me.email, 'command.cancel', c.env, c.action, now);
  return json({ ...c, status: 'canceled', finished_at: now });
}

export async function getAudit(request: Request, env: Bindings): Promise<Response> {
  await authenticateUser(request, env);
  const url = new URL(request.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 50) || 50));
  return json(await listAudit(env.DB, limit));
}

/** 復元用のセッション一覧。本人とオーナーだけ（docs/spec.md 9章）。タイトルはここにだけ出る。 */
export async function getSessions(request: Request, env: Bindings): Promise<Response> {
  const me = await authenticateUser(request, env);
  const url = new URL(request.url);
  const e = url.searchParams.get('env');
  if (!isEnv(e)) throw new HttpError(400, 'env が不正');
  if (!me.enabled_envs.includes(e)) throw new HttpError(400, `${e} はこの導入で使っていない`);
  if (!canOperate(me, e)) throw new HttpError(403, 'この環境のセッションを見る権限がない');
  return json(await listSessions(env.DB, e, Date.now()));
}

/**
 * スマートプラグでの電源の入れ直し（docs/spec.md 6.1）の歯止め。強制電源断なので、
 * Worker に SwitchBot の設定があり、host の報告が 10 分以上途絶えている（または一度も無い）ときだけ受け付ける。
 * 画面でボタンを隠すだけにしない（CLAUDE.md 4）。
 */
async function checkPowerCycleAllowed(env: Bindings, now: Millis): Promise<void> {
  if (!switchbotConfig(env)) {
    throw new HttpError(
      503,
      'スマートプラグが未設定（wrangler secret の SWITCHBOT_TOKEN / SWITCHBOT_SECRET と SWITCHBOT_PLUG_DEVICE_ID）',
    );
  }
  const rows = await latestHeartbeats(env.DB);
  const live = liveness(rows.get('host')?.received_at ?? null, now);
  if (live === 'ok' || live === 'delayed') {
    throw new HttpError(
      409,
      'Mac mini からの報告が届いているので電源は切らない。10 分以上途絶えたときだけ使える（先に「ホストを再起動」を）',
    );
  }
}

// ---------- 小道具 ----------

export function liveness(receivedAt: Millis | null, now: Millis): Liveness {
  if (receivedAt === null) return 'unknown';
  const d = now - receivedAt;
  if (d < LIVENESS_DELAYED_MS) return 'ok';
  if (d < LIVENESS_UNRESPONSIVE_MS) return 'delayed';
  return 'unresponsive';
}

function pct(used: number | undefined, total: number | undefined): number | null {
  if (used === undefined || total === undefined || total <= 0) return null;
  return Math.round((used / total) * 100);
}

/** action ごとに決めたキーだけ通す。それ以外は捨てる（任意の入力をエージェントに流さない）。 */
function parseArgs(
  action: Command['action'],
  raw: Record<string, unknown> | undefined,
): CommandArgs | null {
  if (action === 'session_restore') {
    const session_id = raw ? str(raw, 'session_id') : undefined;
    if (!session_id || session_id.length > 128) throw new HttpError(400, 'session_id が必要');
    return { session_id };
  }
  if (action === 'rc_start_dir' || action === 'rc_stop_dir') {
    const dir = raw ? str(raw, 'dir') : undefined;
    if (!isRcDirName(dir)) throw new HttpError(400, 'dir はフォルダ名だけ（パスは不可）');
    return { dir };
  }
  if (action === 'rc_mkdir') {
    const dir = raw ? str(raw, 'dir') : undefined;
    if (!isRcDirName(dir)) throw new HttpError(400, 'dir はフォルダ名だけ（パスは不可）');
    // 作成後に続けて Remote Control を起動するか。true 以外は捨てる
    return raw?.start === true ? { dir, start: true } : { dir };
  }
  if (action === 'rc_permission_set' || action === 'claude_permission_set') {
    const mode = raw?.permission_mode;
    if (!isRcPermissionMode(mode)) throw new HttpError(400, 'permission_mode が不正');
    return { permission_mode: mode };
  }
  return null;
}

export type { Identity };

/**
 * VNC パスワード（docs/spec.md 13章 #16）。Worker の secret VNC_PASSWORDS_JSON から、押したときだけ本人・オーナーに返す。
 * D1・ハートビート・ログには置かない。見たことだけ監査ログに残す（値は残さない）。
 */
export async function getVncPassword(request: Request, env: Bindings): Promise<Response> {
  const me = await authenticateUser(request, env);
  const url = new URL(request.url);
  const e = url.searchParams.get('env');
  if (!isEnv(e)) throw new HttpError(400, 'env が不正');
  if (!me.enabled_envs.includes(e)) throw new HttpError(400, `${e} はこの導入で使っていない`);
  if (!canOperate(me, e)) throw new HttpError(403, 'この環境の VNC パスワードを見る権限がない');
  const pw = vncPasswordFor(env.VNC_PASSWORDS_JSON, e);
  if (!pw) {
    throw new HttpError(
      404,
      'このマシンの VNC パスワードは未登録（wrangler secret put VNC_PASSWORDS_JSON で登録する）',
    );
  }
  await audit(env.DB, me.email, 'vnc.password.view', e, null, Date.now());
  const res = json({ env: e, password: pw });
  res.headers.set('cache-control', 'no-store');
  return res;
}

function vncPasswordFor(raw: string | undefined, e: Env): string | undefined {
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(500, 'VNC_PASSWORDS_JSON が JSON として読めない');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new HttpError(500, 'VNC_PASSWORDS_JSON の形が不正');
  }
  const v = (parsed as Record<string, unknown>)[e];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
