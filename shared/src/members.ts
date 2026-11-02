import { ENVS, isEnv, type Env } from './env.js';

/**
 * MEMBERS_JSON（環境変数）の形。docs/spec.md 4.2。
 * 例: {"owner":"taro@example.com","envs":{"host":"taro@example.com","vm1":"…","vm2":"…"},"viewers":["…"]}
 * envs の host は必須。vm1 / vm2 は使う VM だけ書く（0〜2 台。macOS の使用許諾で、1 台の Mac で動かせる
 * macOS の VM は 2 つまで）。書かなかった VM は無いものとして扱う（一覧に出さない・報告と指示を受け付けない）。
 * Access で許可されていてこの一覧に無い人は閲覧者として扱う。
 */
export interface MembersConfig {
  owner: string;
  envs: Partial<Record<Env, string>> & { host: string };
  viewers: string[];
  /** 使う環境（ENVS の順。host は必ず先頭） */
  enabled: Env[];
}

export type Role = 'owner' | 'member' | 'viewer';

export interface Identity {
  email: string;
  role: Role;
  /** 操作・接続できる環境 */
  envs: Env[];
  /** この導入で使っている環境（画面の一覧・ナビに出すもの）。host は必ず含む */
  enabled_envs: Env[];
}

/** その環境をこの導入で使っているか（MEMBERS_JSON.envs に書いてあるか） */
export function isEnabledEnv(config: MembersConfig, env: Env): boolean {
  return config.enabled.includes(env);
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
  if (!isEmail(envsRaw.host)) throw new Error('MEMBERS_JSON.envs.host がメールアドレスでない');
  const envs = { host: envsRaw.host.toLowerCase() } as MembersConfig['envs'];
  for (const env of ENVS) {
    if (env === 'host' || envsRaw[env] === undefined || envsRaw[env] === null) continue;
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
    enabled: ENVS.filter((e) => envs[e] !== undefined),
  };
}

/** Access の JWT から取ったメールをロールに変換する。判定はサーバー側でだけ行う。 */
export function resolveIdentity(config: MembersConfig, emailRaw: string): Identity {
  const email = emailRaw.toLowerCase();
  const enabled = [...config.enabled];
  if (email === config.owner) return { email, role: 'owner', envs: enabled, enabled_envs: enabled };
  const envs = config.enabled.filter((env) => config.envs[env] === email);
  if (envs.length > 0) return { email, role: 'member', envs, enabled_envs: enabled };
  return { email, role: 'viewer', envs: [], enabled_envs: enabled };
}

export function canOperate(id: Identity, env: Env): boolean {
  return id.role === 'owner' || id.envs.includes(env);
}
