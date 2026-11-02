#!/usr/bin/env node
// 導入先の値（kit/site.json）で、リポジトリに書かれた固有の値（kit/source.json）を置き換える。
//
//   node kit/personalize.mjs kit/site.json --dry-run   # 何がどれだけ変わるかだけ表示
//   node kit/personalize.mjs kit/site.json             # 書き換える
//
// 置き換えるもの：ドメイン・ダッシュボードのホスト名・Access のチーム名・launchd のラベル接頭辞・
// メンバーのメール・表示名・macOS のユーザー名・組織名・wrangler.toml の導入先ごとの値。
// 置き換えないもの：design/（参照用モック）、docs/verify.md（確認表）、kit/ 自身、
// docs/*.md の人名（見本の名前のまま。kit/START.md の読み替え表で読む）。
// 終わると kit/source.json を新しい値で上書きするので、もう一度実行すればそこからさらに置き換えられる。
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const sitePath = args.find((a) => !a.startsWith('--')) ?? 'kit/site.json';

function die(msg) {
  console.error(`エラー: ${msg}`);
  process.exit(1);
}

// ---------- 入力の読み込みと検証 ----------
const readJson = (p) => {
  const abs = join(ROOT, p);
  if (!existsSync(abs)) die(`${p} が無い（kit/site.example.json をコピーして埋める）`);
  try {
    return JSON.parse(readFileSync(abs, 'utf8'));
  } catch (e) {
    die(`${p} が JSON として読めない: ${e.message}`);
  }
};
const src = readJson('kit/source.json');
const site = readJson(sitePath);

const ENVS = ['host', 'vm1', 'vm2'];
const RE = {
  domain: /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/,
  team: /^[a-z0-9][a-z0-9-]{0,62}$/,
  label: /^[a-z0-9-]+(\.[a-z0-9-]+)+$/,
  login: /^[a-z_][a-z0-9_-]{0,31}$/,
  email: /^[^\s@"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]+$/,
  name: /^[^\s"'<>`\\]{1,24}$/,
};
const errors = [];
const need = (ok, msg) => ok || errors.push(msg);
need(
  typeof site.org_name === 'string' && site.org_name.trim() && !/[<>"]/.test(site.org_name),
  'org_name',
);
need(typeof site.org_footer === 'string' && !/[<>"]/.test(site.org_footer), 'org_footer');
need(RE.domain.test(site.domain ?? ''), 'domain（例 example.com。小文字）');
need(RE.domain.test(site.dashboard_host ?? ''), 'dashboard_host（例 workstation.example.com）');
need(
  typeof site.dashboard_host === 'string' &&
    site.dashboard_host.endsWith(`.${site.domain}`) &&
    !site.dashboard_host.slice(0, -site.domain.length - 1).includes('.'),
  'dashboard_host は domain の 1 階層下にする（例 workstation.<domain>。Cloudflare の無料証明書が効く範囲）',
);
need(
  RE.team.test(site.access_team ?? ''),
  'access_team（Zero Trust のチーム名。<team>.cloudflareaccess.com の <team>）',
);
need(RE.label.test(site.label_prefix ?? ''), 'label_prefix（逆ドメイン。例 com.example）');
need(typeof site.timezone === 'string' && site.timezone.includes('/'), 'timezone（例 Asia/Tokyo）');
need(site.people?.host, 'people.host（Mac mini 本体を使う人。必須）');
for (const env of ENVS) {
  const p = site.people?.[env];
  // VM（vm1 / vm2）は使うものだけ書く。0〜2 台（macOS の使用許諾で、1 台の Mac で動かせる macOS の VM は 2 つまで）
  if (env !== 'host' && (p === undefined || p === null)) continue;
  need(
    p && RE.name.test(p.name ?? ''),
    `people.${env}.name（空白・記号なしの表示名。24 文字まで）`,
  );
  need(p && RE.login.test(p.login ?? ''), `people.${env}.login（macOS の短いユーザー名。小文字）`);
  need(p && RE.email.test(p.email ?? ''), `people.${env}.email`);
}
need(
  Array.isArray(site.viewers) && site.viewers.every((v) => RE.email.test(v)),
  'viewers（メールの配列。空でよい）',
);
const cf = site.cloudflare ?? {};
need(typeof cf === 'object', 'cloudflare はオブジェクト');
need(
  !cf.d1_database_id || /^[0-9a-f-]{36}$/.test(cf.d1_database_id),
  'cloudflare.d1_database_id（wrangler d1 create の出力の UUID）',
);
for (const k of ['access_aud_dashboard', 'access_aud_agent'])
  need(
    !cf[k] || /^[0-9a-f]{64}$/.test(cf[k]),
    `cloudflare.${k}（Access アプリの AUD タグ。64 桁の 16 進）`,
  );
need(
  !cf.switchbot_plug_device_id || /^[0-9A-Za-z-]{4,64}$/.test(cf.switchbot_plug_device_id),
  'cloudflare.switchbot_plug_device_id',
);
if (errors.length) die(`site.json の次の項目を直す:\n  - ${errors.join('\n  - ')}`);
/** 使う環境（site.json の people に書いたもの） */
const ENABLED = ENVS.filter((e) => site.people[e]);
/**
 * 置き換えに使う人の値。使わない VM は今の値（source.json）のまま残す（画面には出ないが、
 * あとで使うことにしたときに置き換えられるように source.json にも残す）
 */
const people = Object.fromEntries(ENVS.map((e) => [e, site.people[e] ?? src.people[e]]));
const names = ENVS.map((e) => people[e].name);
if (new Set(names).size !== 3)
  die(
    'people の name が重なっている（使わない VM の名前は source.json の値のまま残るので、それとも別にする）',
  );
const logins = ENVS.map((e) => people[e].login);
if (new Set(logins).size !== 3) die('people の login が重なっている');

// ---------- 置き換え規則 ----------
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const W = '(?<![A-Za-z0-9_.-])'; // 語の前（メール・パスの一部は除く）
const WE = '(?![A-Za-z0-9_-])'; // 語の後

/** 規則 = [正規表現の断片, 置き換え後]。1 回の走査で左から順に当てる（置き換えた結果をもう一度置き換えない）。 */
function rules(kind) {
  const r = [];
  const add = (from, to, raw = false) => {
    if (from && from !== to) r.push([raw ? from : esc(from), to]);
  };
  // 長いもの・具体的なものを先に
  if (kind === 'full') for (const e of ENVS) add(src.people[e].email, people[e].email);
  add(src.dashboard_host, site.dashboard_host);
  add(`${src.access_team}.cloudflareaccess.com`, `${site.access_team}.cloudflareaccess.com`);
  add(`${src.label_prefix}.`, `${site.label_prefix}.`);
  if (kind === 'docs') {
    // 文書は SSH / VNC のホスト名だけ（ssh-host.<domain> など）
    for (const p of ['ssh', 'vnc'])
      for (const e of [...ENVS, '${env}', '<env>'])
        add(`${p}-${e}.${src.domain}`, `${p}-${e}.${site.domain}`);
    return r;
  }
  if (kind === 'full') {
    add(src.org_footer, site.org_footer);
    add(`${src.access_team} の Slack`, `${site.org_name} の Slack`);
    add(src.org_name, site.org_name);
  }
  add(src.domain, site.domain); // テストのメール（…@<domain>）もここで揃う
  return r;
}
/** 人名とログイン名。画面・ガイド・スクリプトの使い方など、利用者に見える所だけ */
function peopleRules({ logins: withLogins, team }) {
  const r = [];
  for (const e of ENVS) {
    const a = src.people[e];
    const b = people[e];
    if (a.name !== b.name) r.push([`${W}${esc(a.name)}${WE}`, b.name]);
    if (withLogins && a.login !== b.login) r.push([`${W}${esc(a.login)}${WE}`, b.login]);
  }
  if (team && src.access_team !== site.access_team)
    r.push([`${W}${esc(src.access_team)}(?![A-Za-z0-9_.-])`, site.access_team]);
  return r;
}

function apply(text, ruleList) {
  if (!ruleList.length) return [text, 0];
  const re = new RegExp(ruleList.map(([f]) => `(${f})`).join('|'), 'g');
  let n = 0;
  const out = text.replace(re, (...m) => {
    const i = m.slice(1, ruleList.length + 1).findIndex((g) => g !== undefined);
    n++;
    return ruleList[i][1];
  });
  return [out, n];
}

// ---------- 対象ファイル ----------
function listFiles() {
  try {
    return execSync('git ls-files -co --exclude-standard', {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .filter(Boolean)
      .filter((f) => existsSync(join(ROOT, f)));
  } catch {
    const out = [];
    const walk = (d) => {
      for (const ent of readdirSync(d, { withFileTypes: true })) {
        if (['node_modules', '.git', '.wrangler'].includes(ent.name)) continue;
        const p = join(d, ent.name);
        if (ent.isDirectory()) walk(p);
        else out.push(relative(ROOT, p));
      }
    };
    walk(ROOT);
    return out;
  }
}
const TEXT =
  /\.(ts|mts|js|mjs|cjs|json|webmanifest|toml|html|css|md|sh|plist|ya?ml|example|sql|conf|txt)$|(^|\/)(\.dev\.vars\.example|sudoers\.d\/[^/]+|newsyslog\.d\/[^/]+)$/;
const SKIP = [
  /^design\//,
  /^docs\/verify\.md$/,
  /^kit\//,
  /(^|\/)node_modules\//,
  /^package-lock\.json$/,
  /^cloudflare\/access\/ca\/.*\.pub(\.|$)/,
  /^worker\/public\/app\.js$/,
];
const isTest = (f) => /^(worker|agent)\/test\//.test(f) || /vitest\.config\.ts$/.test(f);
const PEOPLE_FILES = [
  /^worker\/public\//,
  /^worker\/ui\//,
  /^mac\//,
  /^cloudflare\/cloudflared\//,
  /^CLAUDE\.md$/,
];
const LOGIN_FILES = [/^worker\/public\/guide\//, /^worker\/ui\/people\.ts$/, /^mac\//];
const TEAM_WORD_FILES = [/^worker\/public\/guide\//];

const files = listFiles().filter((f) => TEXT.test(f) && !SKIP.some((re) => re.test(f)));
const changed = [];
for (const f of files) {
  const abs = join(ROOT, f);
  const before = readFileSync(abs, 'utf8');
  const kind = isTest(f) ? 'test' : f.endsWith('.md') && f !== 'CLAUDE.md' ? 'docs' : 'full';
  let text = before;
  let total = 0;
  const pass = (rl) => {
    const [t, n] = apply(text, rl);
    text = t;
    total += n;
  };
  if (kind === 'full' && PEOPLE_FILES.some((re) => re.test(f))) {
    // メール・ホスト名を先に置き換えてから人名（メールの一部を人名として拾わない）
    pass(rules('full'));
    pass(
      peopleRules({
        logins: LOGIN_FILES.some((re) => re.test(f)),
        team: TEAM_WORD_FILES.some((re) => re.test(f)),
      }),
    );
  } else {
    pass(rules(kind));
  }

  // 個別の書き換え
  if (f === 'worker/ui/people.ts') {
    for (const e of ENVS) {
      const re = new RegExp(`(\\n  ${e}: \\{[\\s\\S]*?initial: ')[^']*(')`);
      text = text.replace(re, `$1${people[e].name[0].toUpperCase()}$2`);
    }
  }
  if (f === 'worker/wrangler.toml') text = wrangler(text);
  if (f === 'worker/public/manifest.webmanifest') {
    // 使わない VM のショートカットを外す
    const m = JSON.parse(text);
    if (Array.isArray(m.shortcuts))
      m.shortcuts = m.shortcuts.filter(
        (x) => !ENVS.some((e) => e !== 'host' && !ENABLED.includes(e) && x.url === `/${e}.html`),
      );
    text = JSON.stringify(m, null, 2) + '\n';
  }

  if (text !== before) {
    changed.push([f, total]);
    if (!DRY) writeFileSync(abs, text);
  }
}

function wrangler(t) {
  const members = {
    owner: site.people.host.email,
    envs: Object.fromEntries(ENABLED.map((e) => [e, site.people[e].email])),
    viewers: site.viewers,
  };
  t = t.replace(/^MEMBERS_JSON = '.*'$/m, `MEMBERS_JSON = '${JSON.stringify(members)}'`);
  t = t.replace(/^TZ_DISPLAY = ".*"$/m, `TZ_DISPLAY = "${site.timezone}"`);
  // Cloudflare アカウントごとの値。site.json の cloudflare に書いてあればそれを入れる（無ければ今の値のまま）。
  const cf = site.cloudflare ?? {};
  const set = (key, v) => {
    if (typeof v === 'string' && v)
      t = t.replace(new RegExp(`^(${key} = )"[^"]*"`, 'm'), `$1"${v}"`);
  };
  set('database_id', cf.d1_database_id);
  set('ACCESS_AUD_DASHBOARD', cf.access_aud_dashboard);
  set('ACCESS_AUD_AGENT', cf.access_aud_agent);
  set('SWITCHBOT_PLUG_DEVICE_ID', cf.switchbot_plug_device_id);
  return t;
}

// ---------- ファイル名（launchd のラベル） ----------
const renames = [];
if (src.label_prefix !== site.label_prefix) {
  for (const f of listFiles()) {
    const base = f.split('/').pop();
    if (base.startsWith(`${src.label_prefix}.`) && !SKIP.some((re) => re.test(f))) {
      const to = join(dirname(f), site.label_prefix + base.slice(src.label_prefix.length));
      renames.push([f, to]);
      if (!DRY) renameSync(join(ROOT, f), join(ROOT, to));
    }
  }
}

// ---------- 記録と報告 ----------
if (!DRY) {
  const { _comment } = src;
  writeFileSync(
    join(ROOT, 'kit/source.json'),
    JSON.stringify({ _comment, ...stripComment(site), people }, null, 2) + '\n',
  );
}
function stripComment(o) {
  const rest = { ...o };
  delete rest._comment;
  delete rest.cloudflare;
  return rest;
}

console.log(`${DRY ? '[dry-run] ' : ''}書き換え ${changed.length} ファイル`);
for (const [f, n] of changed) console.log(`  ${String(n).padStart(4)}  ${f}`);
if (renames.length) {
  console.log('ファイル名の変更');
  for (const [a, b] of renames) console.log(`  ${a} → ${b}`);
}

// 置き換え後に元の値が残っていないか（利用者に見える所だけ）
if (!DRY) {
  const left = [];
  const oldWords = [src.domain, src.label_prefix, ...ENVS.map((e) => src.people[e].name)].filter(
    (w, i) => w !== [site.domain, site.label_prefix, ...names][i],
  );
  const re = new RegExp(oldWords.map((w) => `${W}${esc(w)}`).join('|'));
  for (const f of listFiles()) {
    if (!TEXT.test(f) || SKIP.some((s) => s.test(f)) || f.endsWith('.md') || isTest(f)) continue;
    if (!PEOPLE_FILES.some((p) => p.test(f)) && !/\.(toml|plist|sh|json|webmanifest)$/.test(f))
      continue;
    readFileSync(join(ROOT, f), 'utf8')
      .split('\n')
      .forEach(
        (line, i) => re.test(line) && left.push(`  ${f}:${i + 1}: ${line.trim().slice(0, 120)}`),
      );
  }
  if (left.length && oldWords.length) {
    console.log(`\n元の値が残っている行（${left.length}）。必要なら手で直す:`);
    console.log(left.slice(0, 40).join('\n'));
  }
  console.log(
    '\n次にやること:\n' +
      '  npm run build:ui --workspace worker   # 画面（worker/public/app.js）を作り直す\n' +
      '  npm run typecheck && npm test --workspaces --if-present\n' +
      '  worker/public/logo.png・ガイドの画面写真（worker/public/guide/*.jpg）は見本。差し替えてよい（kit/START.md 2 章）',
  );
}
