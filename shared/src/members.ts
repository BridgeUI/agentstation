import { ENVS, isEnv, type Env } from './env.js';

/**
 * MEMBERS_JSON（環境変数）の形。docs/spec.md 4.2。
 * 例: {"owner":"taro@example.com","envs":{"host":"taro@example.com","vm1":"…","vm2":"…"},"viewers":["…"]}
 * Access で許可されていてこの一覧に無い人は閲覧者として扱う。
 */
export interface MembersConfig {
  owner: string;
  envs: Record<Env, string>;
  viewers: string[];
}

export type Role = 'owner' | 'member' | 'viewer';

export interface Identity {
  email: string;
  role: Role;
  /** 操作・接続できる環境 */
  envs: Env[];
}

function isEmail(x: unknown): x is string {
  return typeof x === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x);
}

/** 起動時に一度だけ呼び、形が違えば例外で止める（黙って閲覧者扱いにしない）。 */
export function parseMembersConfig(json: string | undefined): MembersConfig {
  if (!json) throw new Error('MEMBERS_JSON が設定されていない');
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('MEMBERS_JSON が JSON として読めない');
  }
  if (typeof raw !== 'object' || raw === null)
    throw new Error('MEMBERS_JSON はオブジェクトである必要がある');
  const r = raw as Record<string, unknown>;

  if (!isEmail(r.owner)) throw new Error('MEMBERS_JSON.owner がメールアドレスでない');

  if (typeof r.envs !== 'object' || r.envs === null) throw new Error('MEMBERS_JSON.envs がない');
  const envsRaw = r.envs as Record<string, unknown>;
  const envs = {} as Record<Env, string>;
  for (const env of ENVS) {
    const v = envsRaw[env];
    if (!isEmail(v)) throw new Error(`MEMBERS_JSON.envs.${env} がメールアドレスでない`);
    envs[env] = v.toLowerCase();
  }
  for (const k of Object.keys(envsRaw)) {
    if (!isEnv(k)) throw new Error(`MEMBERS_JSON.envs に知らない環境 ${k} がある`);
  }

  const viewers = Array.isArray(r.viewers) ? r.viewers : [];
  for (const v of viewers) {
    if (!isEmail(v)) throw new Error('MEMBERS_JSON.viewers にメールアドレスでないものがある');
  }

  return {
    owner: r.owner.toLowerCase(),
    envs,
    viewers: (viewers as string[]).map((v) => v.toLowerCase()),
  };
}

/** Access の JWT から取ったメールをロールに変換する。判定はサーバー側でだけ行う。 */
export function resolveIdentity(config: MembersConfig, emailRaw: string): Identity {
  const email = emailRaw.toLowerCase();
  if (email === config.owner) return { email, role: 'owner', envs: [...ENVS] };
  const envs = ENVS.filter((env) => config.envs[env] === email);
  if (envs.length > 0) return { email, role: 'member', envs };
  return { email, role: 'viewer', envs: [] };
}

export function canOperate(id: Identity, env: Env): boolean {
  return id.role === 'owner' || id.envs.includes(env);
}
