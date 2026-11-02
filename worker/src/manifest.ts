import { parseMembersConfig, parseSiteConfig } from '@agentstation/shared';
import type { Bindings } from './env.js';

/**
 * public/manifest.webmanifest に、使っている環境（MEMBERS_JSON.envs）のショートカットと名前（SITE_JSON）を入れて返す。
 * 静的ファイルは見本の値のまま置いておき、ここで導入先の値にする。
 */
export async function manifest(request: Request, env: Bindings): Promise<Response> {
  const res = await env.ASSETS.fetch(request);
  if (!res.ok) return res;
  const m = (await res.json()) as Record<string, unknown>;
  const site = parseSiteConfig(env.SITE_JSON);
  const enabled = parseMembersConfig(env.MEMBERS_JSON).enabled;
  const icon = [{ src: '/icons/icon-192.png', sizes: '192x192' }];
  m.shortcuts = enabled.map((e) => ({
    name: `${site.people[e].name} の環境`,
    url: `/${e}.html`,
    icons: icon,
  }));
  m.name = site.app_name;
  m.short_name = site.app_short_name;
  m.description = `${site.org_name} の Claude Code 環境の状態確認と操作`;
  return new Response(JSON.stringify(m), {
    headers: { 'content-type': 'application/manifest+json', 'cache-control': 'no-store' },
  });
}
