/** 環境の識別子。URL・D1・ログではマシン名で固定する（使う人が替わっても変えない）。 */
export const ENVS = ['host', 'vm1', 'vm2'] as const;
export type Env = (typeof ENVS)[number];

export const VM_ENVS = ['vm1', 'vm2'] as const;
export type VmEnv = (typeof VM_ENVS)[number];

export function isEnv(x: unknown): x is Env {
  return typeof x === 'string' && (ENVS as readonly string[]).includes(x);
}

export function isVmEnv(x: unknown): x is VmEnv {
  return typeof x === 'string' && (VM_ENVS as readonly string[]).includes(x);
}

/** unix ミリ秒（UTC）。D1 と API の時刻はすべてこれ。 */
export type Millis = number;
