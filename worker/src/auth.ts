import {
  isEnv,
  isEnabledEnv,
  parseMembersConfig,
  resolveIdentity,
  type Env,
  type Identity,
} from '@macmini/shared';
import type { Bindings } from './env.js';
import { HttpError } from './http.js';

/**
 * Cloudflare Access の JWT（Cf-Access-Jwt-Assertion）を検証する。
 * 権限の判定はここ（サーバー側）でだけ行う。画面でボタンを隠すだけにしない（CLAUDE.md 4）。
 *
 * - 人：ダッシュボード用 Access アプリの aud。email からロールを引く
 * - エージェント：/api/agent 用 Access アプリの aud。サービストークンの common_name から環境を引く
 */

const ASSERTION_HEADER = 'Cf-Access-Jwt-Assertion';
const CLOCK_SKEW_SEC = 60;
const JWKS_TTL_MS = 60 * 60 * 1000;

interface Jwk {
  kid: string;
  kty: string;
  alg?: string;
  n: string;
  e: string;
}

interface AccessClaims {
  aud: string[];
  iss: string;
  exp: number;
  iat?: number;
  nbf?: number;
  email?: string;
  common_name?: string;
  sub?: string;
}

/** JWKS のキャッシュ。isolate が生きている間だけ効く（1時間）。 */
const jwksCache = new Map<string, { fetchedAt: number; keys: Jwk[] }>();

async function fetchJwks(teamDomain: string): Promise<Jwk[]> {
  const cached = jwksCache.get(teamDomain);
  if (cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) return cached.keys;
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new HttpError(503, 'Access の公開鍵を取得できない');
  const body = (await res.json()) as { keys?: Jwk[] };
  const keys = (body.keys ?? []).filter((k) => k.kty === 'RSA' && typeof k.kid === 'string');
  jwksCache.set(teamDomain, { fetchedAt: Date.now(), keys });
  return keys;
}

/** テスト用：キャッシュを捨てる */
export function resetJwksCache(): void {
  jwksCache.clear();
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJson(part: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(b64urlToBytes(part))) as unknown;
    if (typeof parsed !== 'object' || parsed === null) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(401, 'JWT の形が不正');
  }
}

export async function verifyAccessJwt(
  token: string,
  teamDomain: string,
  expectedAud: string,
): Promise<AccessClaims> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new HttpError(401, 'JWT の形が不正');
  const [h, p, s] = parts as [string, string, string];
  const header = decodeJson(h);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') {
    throw new HttpError(401, 'JWT のアルゴリズムが不正');
  }

  const keys = await fetchJwks(teamDomain);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    // 鍵のローテーション直後。一度だけ取り直す
    jwksCache.delete(teamDomain);
    jwk = (await fetchJwks(teamDomain)).find((k) => k.kid === header.kid);
    if (!jwk) throw new HttpError(401, 'JWT の署名鍵が見つからない');
  }

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(s),
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!ok) throw new HttpError(401, 'JWT の署名が不正');

  const claims = decodeJson(p);
  const aud = Array.isArray(claims.aud)
    ? claims.aud.filter((a): a is string => typeof a === 'string')
    : typeof claims.aud === 'string'
      ? [claims.aud]
      : [];
  if (!aud.includes(expectedAud)) throw new HttpError(401, 'JWT の aud が違う');
  if (claims.iss !== `https://${teamDomain}`) throw new HttpError(401, 'JWT の iss が違う');

  const nowSec = Math.floor(Date.now() / 1000);
  const exp = typeof claims.exp === 'number' ? claims.exp : 0;
  if (exp + CLOCK_SKEW_SEC < nowSec) throw new HttpError(401, 'JWT の期限が切れている');
  const nbf = typeof claims.nbf === 'number' ? claims.nbf : undefined;
  if (nbf !== undefined && nbf - CLOCK_SKEW_SEC > nowSec)
    throw new HttpError(401, 'JWT がまだ有効でない');

  return {
    aud,
    iss: claims.iss,
    exp,
    ...(typeof claims.iat === 'number' ? { iat: claims.iat } : {}),
    ...(nbf !== undefined ? { nbf } : {}),
    ...(typeof claims.email === 'string' ? { email: claims.email } : {}),
    ...(typeof claims.common_name === 'string' ? { common_name: claims.common_name } : {}),
    ...(typeof claims.sub === 'string' ? { sub: claims.sub } : {}),
  };
}

/**
 * ローカル開発の代替ログイン。LOCAL_DEV_EMAIL が設定され、かつ接続先が localhost のときだけ有効。
 * 本番のホスト名では決して効かない。
 */
function localDevEmail(request: Request, env: Bindings): string | undefined {
  if (!env.LOCAL_DEV_EMAIL) return undefined;
  const host = new URL(request.url).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') return undefined;
  return env.LOCAL_DEV_EMAIL;
}

function assertion(request: Request): string {
  const token = request.headers.get(ASSERTION_HEADER);
  if (!token) throw new HttpError(401, 'Access のログインが必要');
  return token;
}

/** 画面からの呼び出し。メールアドレスからロールを決める。 */
export async function authenticateUser(request: Request, env: Bindings): Promise<Identity> {
  const devEmail = localDevEmail(request, env);
  if (devEmail) return resolveIdentity(parseMembersConfig(env.MEMBERS_JSON), devEmail);
  const claims = await verifyAccessJwt(
    assertion(request),
    env.ACCESS_TEAM_DOMAIN,
    env.ACCESS_AUD_DASHBOARD,
  );
  if (!claims.email) throw new HttpError(401, 'メールアドレスのある Access ログインが必要');
  return resolveIdentity(parseMembersConfig(env.MEMBERS_JSON), claims.email);
}

export interface AgentIdentity {
  env: Env;
  tokenName: string;
}

/** エージェントからの呼び出し。サービストークンの common_name と環境を突き合わせる（docs/spec.md 3.6）。 */
export async function authenticateAgent(request: Request, env: Bindings): Promise<AgentIdentity> {
  const claims = await verifyAccessJwt(
    assertion(request),
    env.ACCESS_TEAM_DOMAIN,
    env.ACCESS_AUD_AGENT,
  );
  if (!claims.common_name) throw new HttpError(401, 'サービストークンが必要');
  const members = parseMembersConfig(env.MEMBERS_JSON);
  const names = parseTokenNames(env.AGENT_TOKEN_NAMES, members.enabled);
  const found = (Object.entries(names) as [Env, string][]).find(
    ([, n]) => n === claims.common_name,
  );
  if (!found) throw new HttpError(403, 'このサービストークンはどの環境にも対応していない');
  // 使っていない VM（MEMBERS_JSON.envs に無い）からの報告は受け付けない
  if (!isEnabledEnv(members, found[0]))
    throw new HttpError(403, `${found[0]} はこの導入で使っていない（MEMBERS_JSON.envs に無い）`);
  return { env: found[0], tokenName: found[1] };
}

/** AGENT_TOKEN_NAMES。使う環境（enabled）の分は必須。使っていない VM の分は書いてあっても無視される */
function parseTokenNames(json: string, enabled: readonly Env[]): Partial<Record<Env, string>> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new HttpError(500, 'AGENT_TOKEN_NAMES が JSON として読めない');
  }
  if (typeof raw !== 'object' || raw === null)
    throw new HttpError(500, 'AGENT_TOKEN_NAMES の形が不正');
  const out: Partial<Record<Env, string>> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isEnv(k) || typeof v !== 'string' || v.length === 0) {
      throw new HttpError(500, `AGENT_TOKEN_NAMES の ${k} が不正`);
    }
    out[k] = v;
  }
  for (const e of enabled) {
    if (!out[e]) throw new HttpError(500, `AGENT_TOKEN_NAMES に ${e} がない`);
  }
  return out;
}
