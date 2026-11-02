import { DEFAULT_SITE, ENVS, type Env, type SiteView } from '@agentstation/shared';

/**
 * 画面に出す「人」の情報。URL・ID はマシン名（host/vm1/vm2）で固定し、名前とユーザー名は
 * サーバーの SITE_JSON から受け取る（GET /api/me の site。applySite で入れる）。
 * 受け取るまでは見本の値（DEFAULT_SITE）。メールアドレスは置かない（MEMBERS_JSON が本体）。
 */
export interface Person {
  env: Env;
  name: string;
  /** そのマシンの macOS ユーザー名（＝その人の Access メールの @ より前。SSH の宛先に使う） */
  login: string;
  initial: string;
  account: string;
  /** 積み上げバーの色（design/README.md） */
  shade: 'p1' | 'p2' | 'p3';
  /** 内部IP（host は Tart の仮想ブリッジのゲートウェイ。VM は vm_view.ip） */
  fixedIp?: string;
}

const STATIC: Record<Env, Pick<Person, 'account' | 'shade' | 'fixedIp'>> = {
  host: { account: 'アカウントA', shade: 'p1', fixedIp: '192.168.64.1' },
  vm1: { account: 'アカウントB', shade: 'p2' },
  vm2: { account: 'アカウントC', shade: 'p3' },
};

function personOf(env: Env, name: string, login: string): Person {
  return { env, name, login, initial: (name[0] ?? env[0] ?? '?').toUpperCase(), ...STATIC[env] };
}

export const PEOPLE: Record<Env, Person> = Object.fromEntries(
  ENVS.map((e) => [e, personOf(e, DEFAULT_SITE.people[e].name, DEFAULT_SITE.people[e].login)]),
) as Record<Env, Person>;

/** 導入先の表示の値（組織名・ドメイン・チーム名）。applySite で入れる */
export let SITE: SiteView = DEFAULT_SITE;
export let OWNER_NAME = PEOPLE.host.name;

/** /api/me の site を入れる。使っていない環境は環境名のまま */
export function applySite(site: SiteView): void {
  SITE = site;
  for (const e of ENVS) {
    const p = site.people[e];
    PEOPLE[e] = p ? personOf(e, p.name, p.login) : personOf(e, e, e);
  }
  OWNER_NAME = PEOPLE.host.name;
}

export function titleOf(env: Env): string {
  return `${PEOPLE[env].name} の環境`;
}

/** 「Hanako（vm1）」のような短い表記 */
export function shortOf(env: Env): string {
  return `${PEOPLE[env].name}（${env}）`;
}
