#!/usr/bin/env node
// Cloudflare 側の資源を kit/site.json から作る（何度実行しても同じ結果になる。同じ名前があれば作らずに使う）。
//
//   CLOUDFLARE_API_TOKEN=… node kit/cloudflare-setup.mjs           # 計画だけ表示（何も変えない）
//   CLOUDFLARE_API_TOKEN=… node kit/cloudflare-setup.mjs --apply   # 作る
//
// 作るもの（使う環境＝site.json の people に書いた環境の分だけ）：
//   D1 データベース agentstation／ログイン方法（ワンタイム PIN。IdP が 1 つも無いときだけ）／
//   Access の再利用ポリシー（メンバー、環境ごとの利用者、サービストークン）／
//   Access アプリ（ダッシュボード、エージェント API、環境ごとのブラウザ版 SSH・VNC）と SSH の短期証明書の CA／
//   サービストークン（環境ごと）／Tunnel（Cloudflare 側で設定を持つ方式）とその ingress／
//   SSH・VNC のホスト名の DNS（Tunnel への CNAME）／内部ネットワーク 192.168.64.0/24 のルート
// 作らないもの：Zero Trust のチームそのもの（最初に画面で作る）、Google の IdP（Google 側の作業が要る）、
//   WARP の設定（任意。cloudflare/warp/setup.md）、Worker のデプロイ（npm run deploy --workspace worker）。
//
// 秘密情報は画面に出さない。サービストークンの Secret と Tunnel のトークンは
// ~/.config/agentstation/cloudflare/（chmod 600）にだけ書く。site.json には秘密でない値
// （アカウント ID、D1 の ID、AUD、サービストークンの Client ID）を書き戻す。
//
// API トークンに要る権限（Cloudflare › My Profile › API Tokens › Create Custom Token）：
//   Account › Access: Apps and Policies › Edit、Access: Service Tokens › Edit、
//   Access: Organizations, Identity Providers, and Groups › Edit、Cloudflare Tunnel › Edit、D1 › Edit
//   Zone（対象のドメイン）› DNS › Edit
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ENVS = ['host', 'vm1', 'vm2'];
export const NAME = 'agentstation';
export const VM_IPS = { host: '192.168.64.1', vm1: '192.168.64.10', vm2: '192.168.64.11' };
export const PRIVATE_NETWORK = '192.168.64.0/24';

/** Cloudflare API の薄い包み。ページングは per_page=100 で全部たどる */
export function cloudflareApi(
  token,
  fetchImpl = fetch,
  base = 'https://api.cloudflare.com/client/v4',
) {
  async function call(method, path, body) {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error(`${method} ${path}: HTTP ${res.status}（JSON でない応答）`);
    }
    if (!res.ok || data.success === false) {
      const msg = (data.errors ?? [])
        .map((e) => `${e.code ?? ''} ${e.message ?? ''}`.trim())
        .join('; ');
      throw new Error(`${method} ${path}: HTTP ${res.status} ${msg}`);
    }
    return data;
  }
  return {
    async get(path) {
      return (await call('GET', path)).result;
    },
    async list(path) {
      const out = [];
      for (let page = 1; page < 50; page++) {
        const sep = path.includes('?') ? '&' : '?';
        const data = await call('GET', `${path}${sep}page=${page}&per_page=100`);
        const items = Array.isArray(data.result) ? data.result : [];
        out.push(...items);
        const info = data.result_info;
        if (!info || items.length === 0 || page >= (info.total_pages ?? 1)) break;
      }
      return out;
    },
    post: async (path, body) => (await call('POST', path, body)).result,
    put: async (path, body) => (await call('PUT', path, body)).result,
  };
}

/** site.json から作るものの一覧（純粋関数。テストで使う） */
export function desiredState(site) {
  const enabled = ENVS.filter((e) => site.people?.[e]);
  const email = (e) => site.people[e].email.toLowerCase();
  const members = [
    ...new Set([...enabled.map(email), ...(site.viewers ?? []).map((v) => v.toLowerCase())]),
  ];
  return {
    enabled,
    d1: NAME,
    policies: {
      members: { name: `${NAME} members`, decision: 'allow', emails: members },
      service: { name: `${NAME} agents`, decision: 'non_identity' },
      ...Object.fromEntries(
        enabled.map((e) => [
          e,
          {
            name: `${NAME} ${e} users`,
            decision: 'allow',
            // その環境の利用者とオーナー（オーナーは全環境に入れる）
            emails: [...new Set([email(e), email('host')])],
          },
        ]),
      ),
    },
    apps: {
      dashboard: {
        name: NAME,
        type: 'self_hosted',
        domain: site.dashboard_host,
        policy: 'members',
      },
      agent: {
        name: `${NAME}-agent-api`,
        type: 'self_hosted',
        domain: `${site.dashboard_host}/api/agent`,
        policy: 'service',
      },
      ...Object.fromEntries(
        enabled.flatMap((e) => [
          [
            `ssh-${e}`,
            {
              name: `ssh-${e}`,
              type: 'ssh',
              domain: `ssh-${e}.${site.domain}`,
              policy: e,
              ca: true,
            },
          ],
          [
            `vnc-${e}`,
            { name: `vnc-${e}`, type: 'vnc', domain: `vnc-${e}.${site.domain}`, policy: e },
          ],
        ]),
      ),
    },
    tokens: Object.fromEntries(enabled.map((e) => [e, `${NAME}-${e}`])),
    tunnel: NAME,
    ingress: [
      ...enabled.flatMap((e) => [
        // host は cloudflared と同じマシンなので localhost、VM は固定 IP
        {
          hostname: `ssh-${e}.${site.domain}`,
          service: `ssh://${e === 'host' ? 'localhost' : VM_IPS[e]}:22`,
        },
        {
          hostname: `vnc-${e}.${site.domain}`,
          service: `tcp://${e === 'host' ? 'localhost' : VM_IPS[e]}:5900`,
        },
      ]),
      { service: 'http_status:404' },
    ],
    dns: enabled.flatMap((e) => [`ssh-${e}.${site.domain}`, `vnc-${e}.${site.domain}`]),
    network: PRIVATE_NETWORK,
  };
}

/**
 * 計画を立てて、apply なら実行する。返り値は site.json に書き戻す値と、書き出した秘密のファイル。
 * log は 1 行ずつの報告（秘密情報は渡さない）。
 */
export async function run({ api, site, apply, log, secretsDir, accountId: givenAccount }) {
  const want = desiredState(site);
  const out = { cloudflare: { ...(site.cloudflare ?? {}) }, secretFiles: [] };
  const act = async (what, fn) => {
    if (!apply) {
      log(`  作る予定: ${what}`);
      return null;
    }
    const r = await fn();
    log(`  作った: ${what}`);
    return r;
  };
  const writeSecret = (name, value) => {
    mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
    const p = join(secretsDir, name);
    writeFileSync(p, value, { mode: 0o600 });
    chmodSync(p, 0o600);
    out.secretFiles.push(p);
    return p;
  };

  // ---- アカウントとゾーン ----
  let accountId = givenAccount ?? out.cloudflare.account_id;
  if (!accountId) {
    const accounts = await api.list('/accounts');
    if (accounts.length !== 1)
      throw new Error(
        `アカウントが ${accounts.length} 個見える。site.json の cloudflare.account_id に使うアカウントの ID を書く`,
      );
    accountId = accounts[0].id;
  }
  out.cloudflare.account_id = accountId;
  const A = `/accounts/${accountId}`;
  const zones = await api.list(`/zones?name=${encodeURIComponent(site.domain)}`);
  const zone = zones.find((z) => z.name === site.domain);
  if (!zone)
    throw new Error(
      `ゾーン ${site.domain} が見つからない（DNS を Cloudflare に置いているか、トークンの Zone 権限）`,
    );
  log(`アカウント ${accountId}、ゾーン ${site.domain}`);

  // ---- D1 ----
  log('D1');
  const dbs = await api.list(`${A}/d1/database?name=${want.d1}`);
  let db = dbs.find((d) => d.name === want.d1);
  if (db) log(`  ある: ${want.d1}`);
  else
    db = await act(`D1 データベース ${want.d1}`, () =>
      api.post(`${A}/d1/database`, { name: want.d1 }),
    );
  if (db) out.cloudflare.d1_database_id = db.uuid ?? db.id;

  // ---- ログイン方法 ----
  log('ログイン方法');
  const idps = await api.list(`${A}/access/identity_providers`);
  if (idps.length > 0) log(`  ある: ${idps.map((i) => i.type).join(', ')}`);
  else
    await act('ワンタイム PIN（メールに届く番号でログイン。Google はあとから足せる）', () =>
      api.post(`${A}/access/identity_providers`, {
        name: 'One-time PIN',
        type: 'onetimepin',
        config: {},
      }),
    );

  // ---- サービストークン ----
  log('サービストークン');
  const tokens = await api.list(`${A}/access/service_tokens`);
  const tokenIds = {};
  out.cloudflare.agent_client_ids = { ...(out.cloudflare.agent_client_ids ?? {}) };
  for (const [env, name] of Object.entries(want.tokens)) {
    let t = tokens.find((x) => x.name === name);
    if (t) {
      log(
        `  ある: ${name}（Secret は作ったときにしか取れない。無くしたら Cloudflare の画面で作り直す）`,
      );
    } else {
      t = await act(`サービストークン ${name}`, async () => {
        const r = await api.post(`${A}/access/service_tokens`, { name, duration: '8760h' });
        const p = writeSecret(
          `token.${env}.json`,
          JSON.stringify({ client_id: r.client_id, client_secret: r.client_secret }) + '\n',
        );
        log(
          `    Secret を ${p} に書いた（chmod 600。その環境の ~/.config/agentstation/token.json にする）`,
        );
        return r;
      });
    }
    if (t) {
      tokenIds[env] = t.id;
      out.cloudflare.agent_client_ids[env] = t.client_id;
    }
  }

  // ---- 再利用ポリシー ----
  log('Access のポリシー');
  const policies = await api.list(`${A}/access/policies`);
  const policyIds = {};
  for (const [key, p] of Object.entries(want.policies)) {
    const include =
      p.decision === 'non_identity'
        ? Object.values(tokenIds).map((id) => ({ service_token: { token_id: id } }))
        : p.emails.map((e) => ({ email: { email: e } }));
    const body = { name: p.name, decision: p.decision, include };
    const existing = policies.find((x) => x.name === p.name);
    if (existing) {
      // メンバーやトークンが増えたときのために中身は毎回そろえる
      await act(`ポリシー ${p.name} の中身をそろえる`, () =>
        api.put(`${A}/access/policies/${existing.id}`, body),
      );
      policyIds[key] = existing.id;
    } else {
      const r = await act(`ポリシー ${p.name}`, () => api.post(`${A}/access/policies`, body));
      if (r) policyIds[key] = r.id;
    }
  }

  // ---- Access アプリ ----
  log('Access のアプリ');
  const apps = await api.list(`${A}/access/apps`);
  const caKeys = {};
  for (const [key, a] of Object.entries(want.apps)) {
    const body = {
      name: a.name,
      type: a.type,
      domain: a.domain,
      session_duration: '24h',
      ...(policyIds[a.policy] ? { policies: [{ id: policyIds[a.policy], precedence: 1 }] } : {}),
    };
    let app = apps.find((x) => x.name === a.name);
    if (app) {
      log(`  ある: ${a.name}（${a.domain}）`);
      if (policyIds[a.policy])
        await act(`アプリ ${a.name} のポリシーをそろえる`, () =>
          api.put(`${A}/access/apps/${app.id}`, body),
        );
    } else {
      app = await act(`アプリ ${a.name}（${a.domain}）`, () => api.post(`${A}/access/apps`, body));
    }
    if (!app) continue;
    if (key === 'dashboard') out.cloudflare.access_aud_dashboard = app.aud;
    if (key === 'agent') out.cloudflare.access_aud_agent = app.aud;
    if (a.ca) {
      // ブラウザ版 SSH の短期証明書の CA。公開鍵は秘密ではない（各マシンの /etc/ssh/ca.pub に入れる）
      let ca = null;
      try {
        ca = await api.get(`${A}/access/apps/${app.id}/ca`);
      } catch {
        ca = null;
      }
      if (!ca?.public_key)
        ca = await act(`${a.name} の SSH CA`, () => api.post(`${A}/access/apps/${app.id}/ca`, {}));
      if (ca?.public_key) caKeys[key.slice(4)] = ca.public_key;
    }
  }
  for (const [env, key] of Object.entries(caKeys)) {
    if (!apply) break;
    mkdirSync(join(secretsDir, 'ca'), { recursive: true });
    const p = join(secretsDir, 'ca', `ssh-${env}.pub`);
    writeFileSync(p, key.trim() + '\n');
    log(`  SSH CA の公開鍵: ${p}（${env} の /etc/ssh/ca.pub に入れる）`);
  }

  // ---- Tunnel ----
  log('Tunnel');
  const tunnels = await api.list(`${A}/cfd_tunnel?name=${want.tunnel}&is_deleted=false`);
  let tunnel = tunnels.find((t) => t.name === want.tunnel && !t.deleted_at);
  if (tunnel) log(`  ある: ${want.tunnel}`);
  else
    tunnel = await act(`Tunnel ${want.tunnel}（設定は Cloudflare 側で持つ）`, () =>
      api.post(`${A}/cfd_tunnel`, { name: want.tunnel, config_src: 'cloudflare' }),
    );
  if (tunnel) {
    out.cloudflare.tunnel_id = tunnel.id;
    await act(`Tunnel の ingress（${want.ingress.length - 1} 本）`, () =>
      api.put(`${A}/cfd_tunnel/${tunnel.id}/configurations`, { config: { ingress: want.ingress } }),
    );
    if (apply) {
      const tokenValue = await api.get(`${A}/cfd_tunnel/${tunnel.id}/token`);
      const p = writeSecret('tunnel-token', String(tokenValue).trim() + '\n');
      log(
        `  Tunnel のトークンを ${p} に書いた（host で sudo cloudflared service install "$(cat ${p})"）`,
      );
    }

    // ---- DNS ----
    log('DNS');
    for (const fqdn of want.dns) {
      const recs = await api.list(`/zones/${zone.id}/dns_records?name=${encodeURIComponent(fqdn)}`);
      const target = `${tunnel.id}.cfargotunnel.com`;
      const rec = recs.find((r) => r.name === fqdn);
      if (rec && rec.content === target) log(`  ある: ${fqdn}`);
      else if (rec)
        log(`  別の値で既にある（触らない。必要なら手で直す）: ${fqdn} → ${rec.content}`);
      else
        await act(`CNAME ${fqdn} → Tunnel`, () =>
          api.post(`/zones/${zone.id}/dns_records`, {
            type: 'CNAME',
            name: fqdn,
            content: target,
            proxied: true,
          }),
        );
    }

    // ---- 内部ネットワーク（WARP 経由の SSH・VNC・ファイル共有用） ----
    log('内部ネットワークのルート');
    const routes = await api.list(`${A}/teamnet/routes?is_deleted=false`);
    const route = routes.find((r) => r.network === want.network);
    if (route && route.tunnel_id === tunnel.id) log(`  ある: ${want.network}`);
    else if (route) log(`  ${want.network} は別の Tunnel に向いている（触らない）`);
    else
      await act(`ルート ${want.network} → Tunnel`, () =>
        api.post(`${A}/teamnet/routes`, {
          network: want.network,
          tunnel_id: tunnel.id,
          comment: NAME,
        }),
      );
  }
  return out;
}

// ---------- コマンドとして実行したとき ----------
async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const sitePath = args.find((a) => !a.startsWith('--')) ?? join(ROOT, 'kit', 'site.json');
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    console.error(
      'エラー: 環境変数 CLOUDFLARE_API_TOKEN に API トークンを入れて実行する（必要な権限はこのファイルの先頭）',
    );
    process.exit(1);
  }
  if (!existsSync(sitePath)) {
    console.error(`エラー: ${sitePath} が無い（kit/site.example.json をコピーして埋める）`);
    process.exit(1);
  }
  const site = JSON.parse(readFileSync(sitePath, 'utf8'));
  const secretsDir = join(homedir(), '.config', 'agentstation', 'cloudflare');
  console.log(apply ? '作る（--apply）' : '計画だけ（変更しない。作るときは --apply）');
  const result = await run({
    api: cloudflareApi(token),
    site,
    apply,
    log: (l) => console.log(l),
    secretsDir,
  });
  if (apply) {
    site.cloudflare = result.cloudflare;
    writeFileSync(sitePath, JSON.stringify(site, null, 2) + '\n');
    console.log(`\n${sitePath} に秘密でない値（アカウント ID、D1 の ID、AUD、Client ID）を書いた`);
    const ids = result.cloudflare.agent_client_ids ?? {};
    console.log(`AGENT_TOKEN_NAMES にする値: ${JSON.stringify(ids)}`);
    console.log(
      '次: cd worker && npm run db:migrate:remote && npm run build:ui && npm run deploy（kit/START.md 4 章）',
    );
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(`エラー: ${e.message}`);
    process.exit(1);
  });
}
