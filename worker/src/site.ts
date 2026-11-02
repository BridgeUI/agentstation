import { DEFAULT_SITE, parseSiteConfig, type SiteConfig } from '@agentstation/shared';
import type { Bindings } from './env.js';

/**
 * この Worker の導入先の表示の値（SITE_JSON）。fetch と scheduled の入口で useSite が入れる。
 * デプロイごとに値は 1 つなので、isolate の中で使い回してよい。
 */
let current: SiteConfig = DEFAULT_SITE;

export function useSite(env: Pick<Bindings, 'SITE_JSON'>): SiteConfig {
  current = parseSiteConfig(env.SITE_JSON);
  return current;
}

/** 本体の呼び方（「Mac が応答していません」の Mac）。SITE_JSON の machine_name */
export function machineName(): string {
  return current.machine_name;
}
