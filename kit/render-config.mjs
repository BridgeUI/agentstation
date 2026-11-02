#!/usr/bin/env node
// kit/site.json（導入先の値）から、本番用の Worker の設定 worker/wrangler.deploy.toml を作る。
//
//   node kit/render-config.mjs              # kit/site.json を読む
//   node kit/render-config.mjs other.json   # 別の場所の site.json
//   node kit/render-config.mjs --check      # 書かずに検証だけ（D1 の ID などが空でもよい）
//
// kit/site.json は実体を別の場所（private な場所）に置いてシンボリックリンクにしてもよい。
// site.json の任意の項目：
//   assets_dir                 画面の素材を差し替えるフォルダ（site.json の実体からの相対パス）。
//                              logo.png、icons/*.png、guide/*.jpg など worker/public と同じ並びで置くと、
//                              デプロイのときだけ上書きする（リポジトリのファイルは書き換えない）
//   cloudflare.worker_name     Worker の名前（既定 agentstation。以前の名前で動いている導入を引き継ぐとき）
//   cloudflare.d1_database_name D1 の名前（既定 agentstation。同上）
//
// リポジトリの worker/wrangler.toml は見本の値のまま（ローカル開発用）。本番のデプロイは
// `npm run deploy --workspace worker` が、このスクリプトで作った wrangler.deploy.toml を使う。
// 名前・ドメインなどは SITE_JSON、メンバーと使う環境は MEMBERS_JSON として Worker に渡り、
// 画面はそれを /api/me で受け取って表示する（HTML や画面のコードを書き換えない）。
// 秘密情報はここに入れない（wrangler secret put）。
import {
  cpSync,
  existsSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const sitePath = args.find((a) => !a.startsWith('--')) ?? join(ROOT, 'kit', 'site.json');

function die(msg) {
  console.error(`エラー: ${msg}`);
  process.exit(1);
}

if (!existsSync(sitePath)) die(`${sitePath} が無い（kit/site.example.json をコピーして埋める）`);
let site;
try {
  site = JSON.parse(readFileSync(sitePath, 'utf8'));
} catch (e) {
  die(`site.json が JSON として読めない: ${e.message}`);
}

// ---------- 検証 ----------
const ENVS = ['host', 'vm1', 'vm2'];
const RE = {
  host: /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/,
  team: /^[a-z0-9][a-z0-9-]{0,62}$/,
  login: /^[a-z_][a-z0-9_-]{0,31}$/,
  email: /^[^\s@"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]+$/,
  name: /^[^\s"'<>`\\]{1,24}$/,
  text: /^[^<>"'`\\]{1,60}$/,
};
const errors = [];
const need = (ok, msg) => ok || errors.push(msg);
need(RE.text.test(site.org_name ?? ''), 'org_name（画面に出す組織名。記号 < > " \' ` \\ なし）');
need(RE.text.test(site.org_footer ?? ''), 'org_footer（画面のフッター）');
need(RE.host.test(site.domain ?? ''), 'domain（例 example.com。小文字）');
need(RE.host.test(site.dashboard_host ?? ''), 'dashboard_host（例 workstation.example.com）');
need(
  typeof site.dashboard_host === 'string' &&
    site.dashboard_host.endsWith(`.${site.domain}`) &&
    !site.dashboard_host.slice(0, -String(site.domain).length - 1).includes('.'),
  'dashboard_host は domain の 1 階層下にする（Cloudflare の無料の証明書が効く範囲）',
);
need(RE.team.test(site.access_team ?? ''), 'access_team（Zero Trust のチーム名）');
need(typeof site.timezone === 'string' && site.timezone.includes('/'), 'timezone（例 Asia/Tokyo）');
need(site.people?.host, 'people.host（Mac 本体を使う人。必須）');
for (const env of ENVS) {
  const p = site.people?.[env];
  // VM（vm1 / vm2）は使うものだけ書く。0〜2 台（macOS の使用許諾で、1 台の Mac で動かせる macOS の VM は 2 つまで）
  if (env !== 'host' && (p === undefined || p === null)) continue;
  need(
    p && RE.name.test(p.name ?? ''),
    `people.${env}.name（空白・記号なしの表示名。24 文字まで）`,
  );
  need(p && RE.login.test(p.login ?? ''), `people.${env}.login（macOS の短いユーザー名。小文字）`);
  need(p && RE.email.test(p.email ?? ''), `people.${env}.email（Google ログインのメール）`);
}
need(
  Array.isArray(site.viewers) && site.viewers.every((v) => RE.email.test(v)),
  'viewers（閲覧だけの人のメールの配列。空でよい）',
);
const cf = site.cloudflare ?? {};
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
need(!cf.worker_name || NAME_RE.test(cf.worker_name), 'cloudflare.worker_name（小文字・数字・-）');
need(
  !cf.d1_database_name || NAME_RE.test(cf.d1_database_name),
  'cloudflare.d1_database_name（小文字・数字・-）',
);
// 素材の差し替え：site.json の実体の場所から見たパス
const assetsDir =
  typeof site.assets_dir === 'string' && site.assets_dir
    ? join(dirname(realpathSync(sitePath)), site.assets_dir)
    : null;
need(
  !assetsDir || (existsSync(assetsDir) && statSync(assetsDir).isDirectory()),
  `assets_dir（${assetsDir} が無い）`,
);
need(!cf.d1_database_id || /^[0-9a-f-]{36}$/.test(cf.d1_database_id), 'cloudflare.d1_database_id');
for (const k of ['access_aud_dashboard', 'access_aud_agent'])
  need(!cf[k] || /^[0-9a-f]{64}$/.test(cf[k]), `cloudflare.${k}（64 桁の 16 進）`);
need(
  !cf.switchbot_plug_device_id || /^[0-9A-Za-z-]{4,64}$/.test(cf.switchbot_plug_device_id),
  'cloudflare.switchbot_plug_device_id',
);
if (errors.length) die(`site.json の次の項目を直す:\n  - ${errors.join('\n  - ')}`);
const enabled = ENVS.filter((e) => site.people[e]);
for (const key of ['name', 'login']) {
  const vals = enabled.map((e) => site.people[e][key]);
  if (new Set(vals).size !== vals.length) die(`people の ${key} が重なっている`);
}
const missing = [
  ['d1_database_id', 'D1 の ID（wrangler d1 create agentstation の出力）'],
  ['access_aud_dashboard', 'ダッシュボード用 Access アプリの AUD'],
  ['access_aud_agent', 'エージェント API 用 Access アプリの AUD'],
].filter(([k]) => !cf[k]);

// ---------- Worker の設定 ----------
const members = {
  owner: site.people.host.email,
  envs: Object.fromEntries(enabled.map((e) => [e, site.people[e].email])),
  viewers: site.viewers,
};
const siteJson = {
  org_name: site.org_name,
  org_footer: site.org_footer,
  domain: site.domain,
  dashboard_host: site.dashboard_host,
  access_team: site.access_team,
  people: Object.fromEntries(
    enabled.map((e) => [e, { name: site.people[e].name, login: site.people[e].login }]),
  ),
};

if (CHECK) {
  console.log(`site.json は正しい（使う環境: ${enabled.join(', ')}）`);
  if (missing.length) console.log(`まだ空の値: ${missing.map(([, d]) => d).join('、')}`);
  process.exit(0);
}
if (missing.length)
  die(`デプロイの前に site.json の cloudflare に入れる: ${missing.map(([, d]) => d).join('、')}`);

const src = readFileSync(join(ROOT, 'worker', 'wrangler.toml'), 'utf8');
const lit = (v) => `'${JSON.stringify(v)}'`; // TOML のリテラル文字列（' を含まないことは上で確かめた）
const replace = (text, re, to, label) => {
  if (!re.test(text)) die(`worker/wrangler.toml に ${label} の行が無い`);
  return text.replace(re, to);
};
let out = src;
out = replace(out, /^pattern = ".*"$/m, `pattern = "${site.dashboard_host}"`, 'routes の pattern');
if (cf.worker_name) out = replace(out, /^name = ".*"$/m, `name = "${cf.worker_name}"`, 'name');
if (cf.d1_database_name)
  out = replace(
    out,
    /^database_name = ".*"$/m,
    `database_name = "${cf.d1_database_name}"`,
    'database_name',
  );
if (assetsDir) {
  // worker/public を写してから差し替え、デプロイはその写しを使う（.gitignore 済み）
  const deployAssets = join(ROOT, 'worker', '.deploy-assets');
  rmSync(deployAssets, { recursive: true, force: true });
  cpSync(join(ROOT, 'worker', 'public'), deployAssets, { recursive: true });
  cpSync(assetsDir, deployAssets, { recursive: true });
  out = replace(
    out,
    /^directory = "\.\/public"$/m,
    'directory = "./.deploy-assets"',
    '[assets] の directory',
  );
}
out = replace(out, /^database_id = ".*"$/m, `database_id = "${cf.d1_database_id}"`, 'database_id');
out = replace(out, /^MEMBERS_JSON = '.*'$/m, `MEMBERS_JSON = ${lit(members)}`, 'MEMBERS_JSON');
out = replace(out, /^SITE_JSON = '.*'$/m, `SITE_JSON = ${lit(siteJson)}`, 'SITE_JSON');
out = replace(
  out,
  /^ACCESS_TEAM_DOMAIN = ".*"$/m,
  `ACCESS_TEAM_DOMAIN = "${site.access_team}.cloudflareaccess.com"`,
  'ACCESS_TEAM_DOMAIN',
);
out = replace(
  out,
  /^ACCESS_AUD_DASHBOARD = ".*"$/m,
  `ACCESS_AUD_DASHBOARD = "${cf.access_aud_dashboard}"`,
  'ACCESS_AUD_DASHBOARD',
);
out = replace(
  out,
  /^ACCESS_AUD_AGENT = ".*"$/m,
  `ACCESS_AUD_AGENT = "${cf.access_aud_agent}"`,
  'ACCESS_AUD_AGENT',
);
out = replace(out, /^TZ_DISPLAY = ".*"$/m, `TZ_DISPLAY = "${site.timezone}"`, 'TZ_DISPLAY');
out = replace(
  out,
  /^SWITCHBOT_PLUG_DEVICE_ID = ".*"$/m,
  `SWITCHBOT_PLUG_DEVICE_ID = "${cf.switchbot_plug_device_id ?? ''}"`,
  'SWITCHBOT_PLUG_DEVICE_ID',
);
const header =
  '# 自動生成（kit/render-config.mjs が kit/site.json から作る）。直接直さない。リポジトリには入れない（.gitignore）。\n';
const dest = join(ROOT, 'worker', 'wrangler.deploy.toml');
writeFileSync(dest, header + out);
console.log(
  `worker/wrangler.deploy.toml を作った（使う環境: ${enabled.join(', ')}、${site.dashboard_host}）`,
);
