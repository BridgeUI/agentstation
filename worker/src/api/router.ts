import { parseMembersConfig } from '@agentstation/shared';
import type { Bindings } from '../env.js';
import { HttpError, json } from '../http.js';
import { getWhoami, postHeartbeat, postPoll, postResult } from './agent.js';
import { postNotifyTest } from './notify.js';
import {
  getAudit,
  getMe,
  getSessions,
  getStatus,
  getVncPassword,
  postCancel,
  postCommand,
} from './dashboard.js';

/**
 * API の入口（docs/spec.md 4.1）。
 * - /api/agent/*  : Access サービストークン（環境ごと）
 * - それ以外      : Access JWT（Cf-Access-Jwt-Assertion）＋ロール判定
 * 権限の判定はここ（サーバー側）でだけ行う。画面でボタンを隠すだけにしない。
 */
export async function handleApi(
  request: Request,
  env: Bindings,
  _ctx: ExecutionContext,
): Promise<Response> {
  try {
    return await route(request, env);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error('API error:', (e as Error).message);
    return json({ error: 'サーバー内部のエラー' }, 500);
  }
}

async function route(request: Request, env: Bindings): Promise<Response> {
  const { pathname } = new URL(request.url);
  const m = request.method;

  if (pathname === '/api/health' && m === 'GET') {
    try {
      parseMembersConfig(env.MEMBERS_JSON);
    } catch (e) {
      return json({ error: `設定エラー: ${(e as Error).message}` }, 500);
    }
    return json({ ok: true, now: Date.now() });
  }

  if (pathname === '/api/agent/heartbeat' && m === 'POST') return postHeartbeat(request, env);
  if (pathname === '/api/agent/result' && m === 'POST') return postResult(request, env);
  if (pathname === '/api/agent/poll' && m === 'POST') return postPoll(request, env);
  if (pathname === '/api/agent/whoami' && m === 'GET') return getWhoami(request, env);

  if (pathname === '/api/me' && m === 'GET') return getMe(request, env);
  if (pathname === '/api/status' && m === 'GET') return getStatus(request, env);
  if (pathname === '/api/commands' && m === 'POST') return postCommand(request, env);
  const cancel = /^\/api\/commands\/([A-Za-z0-9-]{1,64})\/cancel$/.exec(pathname);
  if (cancel && m === 'POST') return postCancel(request, env, cancel[1] as string);
  if (pathname === '/api/audit' && m === 'GET') return getAudit(request, env);
  if (pathname === '/api/sessions' && m === 'GET') return getSessions(request, env);
  if (pathname === '/api/vnc-password' && m === 'GET') return getVncPassword(request, env);
  if (pathname === '/api/notify/test' && m === 'POST') return postNotifyTest(request, env);

  throw new HttpError(404, 'そのような API はない');
}
