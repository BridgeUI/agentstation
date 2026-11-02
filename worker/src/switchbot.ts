import type { PlugPower, PlugView } from '@macmini/shared';
import type { Bindings } from './env.js';

/**
 * SwitchBot クラウド API v1.1 の最小クライアント（docs/spec.md 6.1）。
 * 使うのは「プラグの状態を読む」「turnOn / turnOff」だけ。Webhook は使わない（署名が無く、Access の外に口を開けることになる）。
 * 公式: https://github.com/OpenWonderLabs/SwitchBotAPI
 *
 * 認証は token・secret・13 桁ミリ秒時刻 t・nonce。sign は token+t+nonce を secret で HMAC-SHA256 し base64 にしたもの
 * （公式の JavaScript / Python の例と同じ。文書の本文にある「大文字にする」は例と食い違うので、実機で通らなければ要確認）。
 * token・secret・sign はログにも戻り値にも入れない。
 */

export const SWITCHBOT_API = 'https://api.switch-bot.com';
const TIMEOUT_MS = 10_000;

export interface SwitchBotConfig {
  token: string;
  secret: string;
  deviceId: string;
}

/** 3 つ揃っているときだけ設定済み（secret が無い間はプラグの機能を出さない） */
export function switchbotConfig(env: Bindings): SwitchBotConfig | null {
  const token = env.SWITCHBOT_TOKEN?.trim();
  const secret = env.SWITCHBOT_SECRET?.trim();
  const deviceId = env.SWITCHBOT_PLUG_DEVICE_ID?.trim();
  if (!token || !secret || !deviceId) return null;
  return { token, secret, deviceId };
}

export async function signedHeaders(
  token: string,
  secret: string,
  now: number,
  nonce: string = crypto.randomUUID(),
): Promise<Record<string, string>> {
  const t = String(now);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token + t + nonce));
  const sign = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return {
    Authorization: token,
    sign,
    t,
    nonce,
    'content-type': 'application/json; charset=utf8',
  };
}

export type PlugCommand = 'turnOn' | 'turnOff';

interface ApiEnvelope {
  statusCode?: unknown;
  message?: unknown;
  body?: unknown;
}

/** 失敗の短い要約。HTTP の状態と SwitchBot の statusCode だけ（本文やヘッダは入れない） */
export class SwitchBotError extends Error {
  constructor(
    message: string,
    public readonly kind: 'network' | 'http' | 'api',
  ) {
    super(message);
  }
}

async function call(
  cfg: SwitchBotConfig,
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
  now: number,
): Promise<ApiEnvelope> {
  const headers = await signedHeaders(cfg.token, cfg.secret, now);
  let res: Response;
  try {
    res = await fetch(`${SWITCHBOT_API}${path}`, {
      method: init.method,
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const why = e instanceof Error && e.name === 'TimeoutError' ? 'タイムアウト' : '接続できない';
    throw new SwitchBotError(`SwitchBot のクラウドに${why}`, 'network');
  }
  if (!res.ok) throw new SwitchBotError(`SwitchBot API が HTTP ${res.status}`, 'http');
  let env: ApiEnvelope;
  try {
    env = (await res.json()) as ApiEnvelope;
  } catch {
    throw new SwitchBotError('SwitchBot API の応答が JSON ではない', 'api');
  }
  if (env.statusCode !== 100) {
    const code = typeof env.statusCode === 'number' ? env.statusCode : '?';
    throw new SwitchBotError(`SwitchBot API がコード ${code}（${describeCode(code)}）`, 'api');
  }
  return env;
}

/** 公式文書の statusCode。161 = 機器がオフライン（プラグの Wi‑Fi が落ちている） */
function describeCode(code: number | '?'): string {
  switch (code) {
    case 151:
      return '機器の種類が違う';
    case 152:
      return '機器が見つからない';
    case 160:
      return '対応していない命令';
    case 161:
      return '機器がオフライン';
    case 171:
      return 'ハブがオフライン';
    case 190:
      return '内部エラーか命令の形が不正';
    default:
      return '不明';
  }
}

/**
 * プラグの状態を読む。文書の表には on/off の項目が無いが、実機の応答には `power`（"on"/"off"）が入る実装が多い。
 * `weight` は文書では「1 日の消費電力」とあるが、第三者の実装は「現在の W」として扱っている。どちらも実機で確かめる（docs/spec.md 11章）。
 */
export async function readPlug(cfg: SwitchBotConfig, now: number): Promise<PlugView> {
  try {
    const env = await call(
      cfg,
      `/v1.1/devices/${encodeURIComponent(cfg.deviceId)}/status`,
      { method: 'GET' },
      now,
    );
    const body = (typeof env.body === 'object' && env.body !== null ? env.body : {}) as Record<
      string,
      unknown
    >;
    const power = typeof body.power === 'string' ? body.power.toLowerCase() : '';
    const state: PlugPower = power === 'on' ? 'on' : power === 'off' ? 'off' : 'unknown';
    const w = body.weight;
    const watts =
      typeof w === 'number' && Number.isFinite(w) && w >= 0 ? Math.round(w * 10) / 10 : null;
    return { checked_at: now, ok: true, state, watts, error: null };
  } catch (e) {
    return {
      checked_at: now,
      ok: false,
      state: 'unknown',
      watts: null,
      error: e instanceof SwitchBotError ? e.message : 'SwitchBot API で不明なエラー',
    };
  }
}

/** turnOn / turnOff。失敗は SwitchBotError を投げる */
export async function sendPlugCommand(
  cfg: SwitchBotConfig,
  command: PlugCommand,
  now: number,
): Promise<void> {
  await call(
    cfg,
    `/v1.1/devices/${encodeURIComponent(cfg.deviceId)}/commands`,
    { method: 'POST', body: { command, parameter: 'default', commandType: 'command' } },
    now,
  );
}
