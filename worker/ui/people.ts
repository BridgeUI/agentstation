import type { Env } from '@macmini/shared';

/**
 * 画面に出す「人」の情報（CLAUDE.md の表）。URL・ID はマシン名（host/vm1/vm2）で固定し、
 * 使う人が替わってもここだけ直す。メールアドレスは置かない（MEMBERS_JSON が本体）。
 * TODO(API): 表示名を MEMBERS_JSON / GET /api/me に持たせれば、ここを無くせる。
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

export const PEOPLE: Record<Env, Person> = {
  host: {
    env: 'host',
    name: 'Taro',
    login: 'taro',
    initial: 'T',
    account: 'アカウントA',
    shade: 'p1',
    fixedIp: '192.168.64.1',
  },
  vm1: {
    env: 'vm1',
    name: 'Hanako',
    login: 'hanako',
    initial: 'H',
    account: 'アカウントB',
    shade: 'p2',
  },
  vm2: {
    env: 'vm2',
    name: 'Jiro',
    login: 'jiro',
    initial: 'J',
    account: 'アカウントC',
    shade: 'p3',
  },
};

export const OWNER_NAME = 'Taro';

export function titleOf(env: Env): string {
  return `${PEOPLE[env].name} の環境`;
}

/** 「Hanako（vm1）」のような短い表記 */
export function shortOf(env: Env): string {
  return `${PEOPLE[env].name}（${env}）`;
}
