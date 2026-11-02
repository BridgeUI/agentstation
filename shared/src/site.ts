import { ENVS, type Env } from './env.js';

/**
 * 導入先ごとの表示の値（環境変数 SITE_JSON）。秘密ではない。kit/render-config.mjs が kit/site.json から作る。
 * 画面は /api/me の site で受け取り、HTML の data-name などの印に入れる（リポジトリの main には見本の値だけ）。
 * 例: {"org_name":"Example","org_footer":"Example Inc.","domain":"example.com",
 *      "dashboard_host":"workstation.example.com","access_team":"example",
 *      "people":{"host":{"name":"Taro","login":"taro"},"vm1":{"name":"Hanako","login":"hanako"}}}
 */
export interface Person {
  /** 画面に出す名前（「Taro の環境」） */
  name: string;
  /** その環境の macOS のユーザー名（SSH の宛先） */
  login: string;
}

export interface SiteConfig {
  org_name: string;
  org_footer: string;
  /** SSH / VNC のホスト名の親（ssh-host.<domain>） */
  domain: string;
  /** ダッシュボードのホスト名（Slack の通知に載せる URL） */
  dashboard_host: string;
  /** Zero Trust のチーム名（WARP のログインで入れる名前） */
  access_team: string;
  /** 環境ごとの人。書いていない環境は環境名をそのまま出す */
  people: Record<Env, Person>;
}

const NAME_RE = /^[^\s"'<>`\\]{1,24}$/;
const LOGIN_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
const HOST_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;
const TEAM_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const TEXT_RE = /^[^<>"`\\]{0,60}$/;

/** SITE_JSON が無いときの値（ローカル開発・テスト用の見本と同じ） */
export const DEFAULT_SITE: SiteConfig = {
  org_name: 'Example',
  org_footer: 'Example Inc.',
  domain: 'example.com',
  dashboard_host: 'workstation.example.com',
  access_team: 'example',
  people: {
    host: { name: 'Taro', login: 'taro' },
    vm1: { name: 'Hanako', login: 'hanako' },
    vm2: { name: 'Jiro', login: 'jiro' },
  },
};

/** 起動時に形を確かめる。形が違えば例外（黙って見本の値で動かない） */
export function parseSiteConfig(json: string | undefined): SiteConfig {
  if (!json) return DEFAULT_SITE;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('SITE_JSON が JSON として読めない');
  }
  if (typeof raw !== 'object' || raw === null) throw new Error('SITE_JSON はオブジェクトにする');
  const r = raw as Record<string, unknown>;
  const text = (k: string, re: RegExp): string => {
    const v = r[k];
    if (typeof v !== 'string' || !re.test(v)) throw new Error(`SITE_JSON.${k} が不正`);
    return v;
  };
  const peopleRaw = (typeof r.people === 'object' && r.people !== null ? r.people : {}) as Record<
    string,
    unknown
  >;
  const people = {} as Record<Env, Person>;
  for (const env of ENVS) {
    const p = peopleRaw[env];
    if (p === undefined || p === null) {
      people[env] = { name: env, login: env };
      continue;
    }
    const o = p as Record<string, unknown>;
    if (typeof o.name !== 'string' || !NAME_RE.test(o.name))
      throw new Error(`SITE_JSON.people.${env}.name が不正（空白・記号なし 24 文字まで）`);
    if (typeof o.login !== 'string' || !LOGIN_RE.test(o.login))
      throw new Error(`SITE_JSON.people.${env}.login が不正（macOS の短いユーザー名）`);
    people[env] = { name: o.name, login: o.login };
  }
  return {
    org_name: text('org_name', TEXT_RE),
    org_footer: text('org_footer', TEXT_RE),
    domain: text('domain', HOST_RE),
    dashboard_host: text('dashboard_host', HOST_RE),
    access_team: text('access_team', TEAM_RE),
    people,
  };
}

/** 画面に渡す形（使っている環境の人だけ） */
export type SiteView = Omit<SiteConfig, 'people'> & { people: Partial<Record<Env, Person>> };

export function siteView(site: SiteConfig, enabled: readonly Env[]): SiteView {
  const people: Partial<Record<Env, Person>> = {};
  for (const env of ENVS) if (enabled.includes(env)) people[env] = site.people[env];
  return { ...site, people };
}
