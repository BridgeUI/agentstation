#!/usr/bin/env node
// 導入がどこまで済んだかを一度に確かめる。直すべき最初の項目を「次にやること」として出す。
//
//   node kit/doctor.mjs                       # このリポジトリ・site.json・ダッシュボード・この Mac
//   CLOUDFLARE_API_TOKEN=… node kit/doctor.mjs  # Cloudflare 側の資源もそろっているか（変更はしない）
//
// 何も書き換えない。秘密情報（トークンの中身）は出さない。結果は ✓ 済み／✗ 未完了／− 対象外。
// 終了コード：全部済んでいれば 0、未完了があれば 1。
import { execFileSync } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudflareApi, run as cloudflarePlan } from './cloudflare-setup.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONF = join(homedir(), '.config', 'agentstation');
const LABEL = 'co.bridgeui.agentstation';
const results = [];
let section = '';

function record(status, label, hint = '') {
  results.push({ section, status, label, hint });
}
const ok = (label) => record('ok', label);
const ng = (label, hint) => record('ng', label, hint);
const na = (label, hint = '') => record('na', label, hint);
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

async function main() {
  // ---------- 1. このリポジトリ ----------
  section = '1. リポジトリ';
  const major = Number(process.versions.node.split('.')[0]);
  major >= 22
    ? ok(`Node.js ${process.versions.node}`)
    : ng(`Node.js ${process.versions.node}`, 'Node.js 22 以上を入れる');
  const expected = join(homedir(), 'workspace', 'agentstation');
  ROOT === expected
    ? ok(`置き場所 ${ROOT}`)
    : ng(
        `置き場所 ${ROOT}`,
        `~/workspace/agentstation に置く（launchd のラッパーがこのパスを前提にしている）`,
      );
  existsSync(join(ROOT, 'node_modules'))
    ? ok('依存（node_modules）')
    : ng('依存（node_modules）が無い', 'npm ci');

  // ---------- 2. site.json ----------
  section = '2. 導入先の値（kit/site.json）';
  const sitePath = join(ROOT, 'kit', 'site.json');
  let site = null;
  if (!existsSync(sitePath)) {
    ng(
      'kit/site.json が無い',
      'cp kit/site.example.json kit/site.json して埋める（kit/START.md 1 章）',
    );
  } else {
    try {
      const out = execFileSync(
        process.execPath,
        [join(ROOT, 'kit', 'render-config.mjs'), '--check'],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      site = readJson(sitePath);
      ok(out.split('\n')[0]);
      const missing = out.split('\n').find((l) => l.startsWith('まだ空の値'));
      if (missing)
        ng(missing, 'node kit/cloudflare-setup.mjs --apply で埋まる（kit/START.md 3 章）');
    } catch (e) {
      ng(
        'kit/site.json の形が違う',
        String(e.stderr ?? e.message)
          .trim()
          .split('\n')
          .slice(0, 4)
          .join(' / '),
      );
    }
  }

  // ---------- 3. Cloudflare ----------
  section = '3. Cloudflare';
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!site) na('site.json が無いので確かめない');
  else if (!token)
    na(
      'API トークンが無いので Cloudflare 側は確かめない',
      'CLOUDFLARE_API_TOKEN=… を付けて実行すると確かめる',
    );
  else {
    const lines = [];
    try {
      await cloudflarePlan({
        api: cloudflareApi(token),
        site,
        apply: false,
        log: (l) => lines.push(l),
        secretsDir: join(CONF, 'cloudflare'),
      });
      const todo = lines.filter((l) => l.includes('作る予定'));
      todo.length === 0
        ? ok('作るべき資源はそろっている')
        : ng(
            `まだ無い資源が ${todo.length} 個（${todo
              .map((l) => l.replace(/^\s*作る予定: /, ''))
              .slice(0, 3)
              .join('、')}…）`,
            'node kit/cloudflare-setup.mjs --apply',
          );
    } catch (e) {
      ng(
        `Cloudflare API に問い合わせられない: ${e.message}`,
        'トークンの権限（kit/cloudflare-setup.mjs の先頭）を確かめる',
      );
    }
  }

  // ---------- 4. ダッシュボード ----------
  section = '4. ダッシュボード（Worker と Access）';
  if (!site) na('site.json が無いので確かめない');
  else {
    const host = site.dashboard_host;
    try {
      await lookup(host);
      ok(`${host} の DNS が引ける`);
      try {
        const res = await fetch(`https://${host}/`, { redirect: 'manual' });
        const loc = res.headers.get('location') ?? '';
        if (
          res.status >= 300 &&
          res.status < 400 &&
          loc.includes(`${site.access_team}.cloudflareaccess.com`)
        )
          ok('Access がログインを求める（チーム名も一致）');
        else if (res.status >= 300 && res.status < 400 && loc.includes('cloudflareaccess.com'))
          ng(
            'Access はかかっているがチーム名が違う',
            `site.json の access_team と Zero Trust のチーム名をそろえる（転送先 ${new URL(loc).host}）`,
          );
        else
          ng(
            `ログインなしで開けてしまう（HTTP ${res.status}）`,
            'ダッシュボード用の Access アプリを作る（node kit/cloudflare-setup.mjs --apply）',
          );
      } catch (e) {
        ng(
          `https://${host}/ に繋がらない: ${e.message}`,
          'Worker をデプロイする（cd worker && npm run deploy）',
        );
      }
    } catch {
      ng(
        `${host} の DNS が引けない`,
        'Worker をデプロイするとカスタムドメインの DNS ができる（cd worker && npm run deploy）',
      );
    }
  }

  // ---------- 5. この Mac ----------
  section = '5. この Mac';
  if (process.platform !== 'darwin') {
    na('macOS ではないので確かめない');
  } else if (!existsSync(CONF)) {
    na(
      '~/.config/agentstation が無い（まだエージェントを入れていない Mac）',
      'kit/START.md 5 章（host）・6 章（VM）',
    );
  } else {
    const cfgPath = join(CONF, 'config.json');
    let cfg = null;
    try {
      cfg = readJson(cfgPath);
      ok('config.json');
      if (site && cfg.base_url !== `https://${site.dashboard_host}`)
        ng(
          `config.json の base_url（${cfg.base_url}）が site.json と違う`,
          `https://${site.dashboard_host} にする`,
        );
    } catch {
      ng('config.json が無いか読めない', 'kit/START.md 5 章（agent/src/config.ts 冒頭の形）');
    }
    const tokPath = join(CONF, 'token.json');
    let tok = null;
    if (!existsSync(tokPath))
      ng('token.json が無い', 'その環境のサービストークンを置く（chmod 600）');
    else {
      (statSync(tokPath).mode & 0o077) === 0
        ? ok('token.json（chmod 600）')
        : ng('token.json が他人から読める', `chmod 600 ${tokPath}`);
      try {
        tok = readJson(tokPath);
      } catch {
        ng('token.json が JSON として読めない', 'client_id と client_secret の JSON にする');
      }
    }
    // Worker まで届き、トークンが通るか（読むだけの /api/agent/whoami）
    if (cfg?.base_url && tok?.client_id && tok?.client_secret) {
      try {
        const res = await fetch(`${cfg.base_url}/api/agent/whoami`, {
          headers: {
            'CF-Access-Client-Id': tok.client_id,
            'CF-Access-Client-Secret': tok.client_secret,
          },
          redirect: 'manual',
        });
        if (res.status === 200) {
          const w = await res.json();
          const age =
            w.last_received_at === null ? null : Math.round((w.now - w.last_received_at) / 1000);
          ok(`トークンが通る（環境 ${w.env}）`);
          age === null
            ? ng(
                `${w.env} の報告がまだ届いていない`,
                'エージェントの launchd を確かめる（下の項目）',
              )
            : age < 180
              ? ok(`最後の報告は ${age} 秒前`)
              : ng(
                  `最後の報告が ${age} 秒前`,
                  `ログ ~/Library/Logs/agentstation/err.log を見る。再起動は launchctl kickstart -k gui/$(id -u)/${LABEL}.agent`,
                );
        } else if (res.status === 403) {
          ng(
            'トークンが拒否された（403）',
            'AGENT_TOKEN_NAMES の Client ID と、MEMBERS_JSON（site.json の people）にこの環境があるか',
          );
        } else {
          ng(
            `whoami が HTTP ${res.status}`,
            res.status >= 300 && res.status < 400
              ? 'エージェント API の Access アプリ（Service Auth）を確かめる'
              : 'Worker をデプロイし直す',
          );
        }
      } catch (e) {
        ng(`Worker に届かない: ${e.message}`, 'ネットワークと base_url を確かめる');
      }
    }
    // launchd
    const uid = process.getuid?.() ?? 0;
    const jobState = (target) => {
      try {
        const out = execFileSync('/bin/launchctl', ['print', target], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        return /state = running/.test(out) ? 'running' : 'loaded';
      } catch {
        return 'missing';
      }
    };
    const job = (name, label, hint) => {
      const st = jobState(`gui/${uid}/${label}`);
      st === 'running'
        ? ok(`${name} が動いている`)
        : ng(`${name} が${st === 'missing' ? '登録されていない' : '止まっている'}`, hint);
    };
    job('エージェント', `${LABEL}.agent`, 'mac/launchd/README.md の手順で LaunchAgent を入れる');
    job(
      'Remote Control（claude-rc）',
      `${LABEL}.claude-rc`,
      'mac/launchd/README.md。止まっているなら claude auth login が済んでいるか',
    );
    const isHost =
      existsSync(join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.tart-vm1.plist`)) ||
      existsSync(join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.tart-vm2.plist`)) ||
      (cfg && (cfg.tart_path || Array.isArray(cfg.vms)));
    if (isHost) {
      const vms = Array.isArray(cfg?.vms) ? cfg.vms : ['vm1', 'vm2'];
      for (const vm of vms)
        job(
          `${vm}（Tart）`,
          `${LABEL}.tart-${vm}`,
          `mac/launchd/${LABEL}.tart-${vm}.plist を入れる`,
        );
      let cf = false;
      try {
        execFileSync('/usr/bin/pgrep', ['-x', 'cloudflared'], { stdio: 'ignore' });
        cf = true;
      } catch {
        cf = false;
      }
      cf
        ? ok('cloudflared（Tunnel）が動いている')
        : ng(
            'cloudflared が動いていない',
            'sudo cloudflared service install "$(cat ~/.config/agentstation/cloudflare/tunnel-token)"',
          );
    } else {
      na('VM の確認（この Mac は host ではなさそう）');
    }
  }

  // ---------- 報告 ----------
  const mark = { ok: '✓', ng: '✗', na: '−' };
  let current = '';
  for (const r of results) {
    if (r.section !== current) {
      current = r.section;
      console.log(`\n${current}`);
    }
    console.log(
      `  ${mark[r.status]} ${r.label}${r.status !== 'ok' && r.hint ? `\n      → ${r.hint}` : ''}`,
    );
  }
  const first = results.find((r) => r.status === 'ng');
  console.log(
    first
      ? `\n次にやること：${first.hint || first.label}（${first.section}）`
      : '\nすべて済んでいる',
  );
  process.exitCode = first ? 1 : 0;
}

main().catch((e) => {
  console.error(`エラー: ${e.message}`);
  process.exit(2);
});
