import { SELF, env } from 'cloudflare:test';

/** テスト用の Access JWT。公開鍵は vitest.config.ts の outboundService が JWKS として返す。 */

const TEAM = 'team.cloudflareaccess.com';
const KID = 'test-key-1';

let privateKey: CryptoKey | undefined;

async function signingKey(): Promise<CryptoKey> {
  if (!privateKey) {
    const jwk = JSON.parse(env.TEST_PRIVATE_JWK) as JsonWebKey & { kid?: string };
    delete jwk.kid;
    privateKey = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );
  }
  return privateKey;
}

/**
 * Access の JWKS 取得を差し替える。SELF（テスト対象の Worker）はテストと同じ isolate で動くので、
 * グローバルの fetch を置き換えれば Worker 側の fetch にも効く。それ以外の外部アクセスは失敗させる。
 */
export async function mockJwks(): Promise<void> {
  await signingKey();
  if ((globalThis as { __jwksMocked?: boolean }).__jwksMocked) return;
  (globalThis as { __jwksMocked?: boolean }).__jwksMocked = true;
  const jwk = JSON.parse(env.TEST_PRIVATE_JWK) as JsonWebKey;
  const jwks = JSON.stringify({
    keys: [{ kid: KID, kty: 'RSA', alg: 'RS256', use: 'sig', n: jwk.n, e: jwk.e }],
  });
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    if (url.hostname === TEAM && url.pathname === '/cdn-cgi/access/certs') {
      return new Response(jwks, { headers: { 'content-type': 'application/json' } });
    }
    return new Response(`テストから外部へは出られない: `, { status: 502 });
  }) as typeof fetch;
}

function b64url(bytes: Uint8Array | string): string {
  const bin = typeof bytes === 'string' ? bytes : String.fromCharCode(...bytes);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sign(
  claims: Record<string, unknown>,
  opts: { kid?: string } = {},
): Promise<string> {
  const key = await signingKey();
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', kid: opts.kid ?? KID, typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({ iss: `https://${TEAM}`, iat: now, exp: now + 600, ...claims }),
  );
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${b64url(new Uint8Array(sig))}`;
}

export const userToken = (email: string) => sign({ aud: ['aud-dashboard'], email, sub: email });
export const agentToken = (name: string) =>
  sign({ aud: ['aud-agent'], common_name: name, sub: '' });

export async function api(
  path: string,
  init: { method?: string; token?: string; body?: unknown } = {},
): Promise<{ status: number; body: Record<string, unknown> & { error?: string } }> {
  const headers: Record<string, string> = {};
  if (init.token) headers['Cf-Access-Jwt-Assertion'] = init.token;
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  const res = await SELF.fetch(`https://mac.example.test${path}`, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = { raw: text };
  }
  return { status: res.status, body };
}

export const vmHeartbeat = (env: 'vm1' | 'vm2', extra: Record<string, unknown> = {}) => ({
  env,
  agent_version: '0.1.0',
  agent_started_at: Date.now() - 1000,
  sent_at: Date.now(),
  guest: { os_version: '26.1', disk_used_gb: 40, disk_total_gb: 90 },
  claude: { state: 'running', rc_state: 'connected', version: '2.1.0', channel: 'stable' },
  codex: { state: 'running' },
  sessions: [],
  ...extra,
});

export const hostHeartbeat = (extra: Record<string, unknown> = {}) => ({
  env: 'host',
  agent_version: '0.1.0',
  agent_started_at: Date.now() - 1000,
  sent_at: Date.now(),
  host: {
    cpu_cores: 10,
    mem_total_gb: 24,
    disk_total_gb: 512,
    cpu_pct: 30,
    mem_used_gb: 12,
    disk_used_gb: 200,
  },
  claude: { state: 'running', rc_state: 'connected' },
  codex: { state: 'stopped' },
  sessions: [],
  vms: [
    {
      env: 'vm1',
      vm_state: 'running',
      ip: '192.168.64.10',
      usage: { cpu_pct_of_host: 10, mem_gb: 5 },
      alloc: { cpu: 4, mem_gb: 6, disk_gb: 90 },
    },
    { env: 'vm2', vm_state: 'stopped', usage: {}, alloc: { cpu: 4, mem_gb: 6, disk_gb: 90 } },
  ],
  ...extra,
});

export const uuid = () => crypto.randomUUID();
