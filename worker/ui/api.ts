import type {
  ApiError,
  AuditEntry,
  Command,
  CreateCommandRequest,
  MeResponse,
  SessionRow,
  StatusResponse,
} from '@agentstation/shared';

/** 画面から Worker の API を呼ぶ。Access の Cookie はブラウザが自動で付ける。 */

export class ApiFailure extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...init });
  } catch {
    throw new ApiFailure(0, 'サーバーに接続できません');
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err = body && typeof body === 'object' ? (body as ApiError).error : undefined;
    if (res.status === 401) throw new ApiFailure(401, err ?? 'ログインが必要です');
    throw new ApiFailure(res.status, err ?? `エラー（${res.status}）`);
  }
  return body as T;
}

export const api = {
  me: () => call<MeResponse>('/api/me'),
  status: () => call<StatusResponse>('/api/status'),
  audit: (limit = 50) => call<AuditEntry[]>(`/api/audit?limit=${limit}`),
  sessions: (env: string) => call<SessionRow[]>(`/api/sessions?env=${encodeURIComponent(env)}`),
  createCommand: (req: CreateCommandRequest) =>
    call<Command>('/api/commands', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    }),
  /** VNC パスワード。押したときだけ取りに行く（docs/spec.md 13章 #16） */
  vncPassword: (env: string) =>
    call<{ env: string; password: string }>(`/api/vnc-password?env=${encodeURIComponent(env)}`),
  /** Slack のテスト通知（オーナーだけ） */
  notifyTest: () => call<{ sent: boolean; at: number }>('/api/notify/test', { method: 'POST' }),
  cancelCommand: (id: string) =>
    call<Command>(`/api/commands/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
};
