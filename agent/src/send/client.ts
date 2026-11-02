import type { CommandResult, Heartbeat, HeartbeatResponse } from '@agentstation/shared';
import type { AgentConfig } from '../config.js';
import type { Logger } from '../log.js';
import { findForbidden } from './filter.js';

/**
 * Worker との通信（docs/spec.md 4.1）。外向き HTTPS だけ。
 * 失敗（ネットワーク・5xx）は次回に回す（溜めない）。
 */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const REQUEST_TIMEOUT_MS = 20_000;

export class ApiClient {
  constructor(
    private readonly cfg: Pick<AgentConfig, 'baseUrl' | 'clientId' | 'clientSecret'>,
    private readonly log: Logger,
    private readonly fetchImpl: FetchLike = (u, i) => fetch(u, i),
  ) {}

  /** 送れなかった・受け付けられなかったときは null */
  async postHeartbeat(hb: Heartbeat): Promise<HeartbeatResponse | null> {
    const hits = findForbidden(hb);
    if (hits.length > 0) {
      this.log.error('ハートビートに秘密情報らしき値があるため送らない', { keys: hits.join(',') });
      return null;
    }
    const res = await this.post('/api/agent/heartbeat', hb);
    if (!res) return null;
    try {
      const body = (await res.json()) as Partial<HeartbeatResponse>;
      return this.parseResponse(body);
    } catch {
      this.log.warn('ハートビート応答が JSON として読めない');
      return null;
    }
  }

  /** 軽い問い合わせ（状態は送らない）。未実行の指示と次の間隔だけ受け取る */
  async postPoll(env: Heartbeat['env']): Promise<HeartbeatResponse | null> {
    const res = await this.post('/api/agent/poll', { env });
    if (!res) return null;
    try {
      return this.parseResponse((await res.json()) as Partial<HeartbeatResponse>);
    } catch {
      this.log.warn('問い合わせの応答が JSON として読めない');
      return null;
    }
  }

  private parseResponse(body: Partial<HeartbeatResponse>): HeartbeatResponse {
    return {
      commands: Array.isArray(body.commands) ? body.commands : [],
      ...(body.peers ? { peers: body.peers } : {}),
      ...(typeof body.poll_ms === 'number' && body.poll_ms > 0 ? { poll_ms: body.poll_ms } : {}),
    };
  }

  async postResult(result: CommandResult): Promise<boolean> {
    const hits = findForbidden(result);
    const body: CommandResult = { id: result.id, status: result.status };
    if (hits.length > 0) {
      this.log.error('result.output に秘密情報らしき値があるため本文を落とす', { id: result.id });
      body.output = '出力に秘密情報らしき文字列が含まれたため省略';
    } else if (result.output !== undefined) {
      body.output = result.output;
    }
    const res = await this.post('/api/agent/result', body);
    return res !== null;
  }

  private async post(path: string, body: unknown): Promise<Response | null> {
    const url = `${this.cfg.baseUrl}${path}`;
    try {
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'CF-Access-Client-Id': this.cfg.clientId,
          'CF-Access-Client-Secret': this.cfg.clientSecret,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        this.log.warn('API が失敗', { path, status: res.status });
        return null;
      }
      return res;
    } catch (e) {
      this.log.warn('API に届かない', { path, reason: (e as Error).name });
      return null;
    }
  }
}
