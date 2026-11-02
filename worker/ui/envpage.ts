import type {
  AuditEntry,
  CommandAction,
  Env,
  EnvStatus,
  MeResponse,
  StatusResponse,
} from '@macmini/shared';
import { SETUP_CHECK_SPECS, canOperate, setupKeysFor, summarizeSetup } from '@macmini/shared';
import type { SetupCheck } from '@macmini/shared';
import { auditView } from './audit.js';
import { activeBox, canPress, opsFor } from './commands.js';
import { $, html, raw, Raw, ICON_ARROW, ICON_SCREEN, ICON_TERM, explainOpen } from './dom.js';
import { ago, dayTimeLong, gb } from './format.js';
import {
  banners,
  hostHeartbeat,
  hostLiveness,
  judge,
  plugRow,
  rows,
  shares,
  type Row,
} from './judge.js';
import { MAINT, bannerHtml } from './overview.js';
import { PEOPLE, titleOf } from './people.js';

/**
 * 各環境の画面（host.html / vm1.html / vm2.html）。
 * 概要／Remote Control／接続／操作／基礎設定／履歴の 6 タブ。タブの切り替えは main.ts（URL のハッシュ）。
 * 閲覧者には接続・操作のタブを出さない（権限の判定はサーバー。ここは見せ方だけ）。
 */

const DISK_RESERVE_GB = 100;

/** 指示が実行中のあいだ、押せないボタンの脇に出す注記（回転付き） */
/** フォルダ向けの指示が実行中のとき、そのフォルダの行の状態に出す言葉 */
const RC_DIR_PENDING_LABEL: Partial<Record<CommandAction, string>> = {
  rc_mkdir: '作成中',
  rc_start_dir: '起動中',
  rc_stop_dir: '停止中',
};

const WAIT_NOTE = raw(
  html`<span class="spin" aria-hidden="true"></span>実行中の指示が終わるまで待ちます`,
);

export interface EnvPageCtx {
  env: Env;
  me: MeResponse;
  s: StatusResponse;
  audit: AuditEntry[] | null;
  serverOffset: number;
}

export function renderEnvPage(ctx: EnvPageCtx): void {
  const { env, me, s } = ctx;
  const e = s.envs.find((x) => x.env === env);
  if (!e) return;
  const p = PEOPLE[env];
  const v = judge(e, s);
  const canUse = canOperate(me, env);
  const down = hostLiveness(s) === 'unresponsive';
  const own = down ? null : e.heartbeat;

  $('env-title').textContent = titleOf(env);
  const av = document.querySelector<HTMLElement>('.avatar.lg');
  if (av) av.textContent = PEOPLE[env].initial;
  const version = own?.claude.version
    ? `Claude Code ${own.claude.version}${own.claude.channel ? `（${own.claude.channel}）` : ''}`
    : null;
  $('hero-sub').innerHTML = html`<span>${env} · ${p.account}</span>${
      version ? html`<span>${version}</span>` : ''
    }<span>最終受信 ${ago(e.agent_received_at, s.now)}</span>`;
  const pill = $('overall');
  pill.className = `pill s-${v.tone}`;
  pill.innerHTML = html`<span class="dot"></span>${v.label}`;

  // 見出し右：いちばん使う接続ボタン（本人・オーナーだけ）
  $('head-actions').innerHTML = canUse
    ? html`<a class="btn" href="https://ssh-${env}.example.com" rel="noopener"
          >${raw(ICON_TERM)} SSH</a
        ><a class="btn primary" href="https://vnc-${env}.example.com" rel="noopener"
          >${raw(ICON_SCREEN)} 画面共有</a
        >`
    : '';

  // この環境に関係するバナーだけ
  const bs = banners(s).filter(
    (b) => b.title.includes(`（${env}）`) || b.title.startsWith('Mac mini'),
  );
  const bn = $('banners');
  bn.hidden = bs.length === 0;
  bn.innerHTML = bs.map((b) => bannerHtml(b)).join('');

  // 閲覧者には接続・操作のタブを出さない
  for (const a of document.querySelectorAll<HTMLElement>('.tabs a[data-needs-use]'))
    a.hidden = !canUse;

  renderState(ctx, e);
  renderMetrics(ctx, e);
  renderTodo(ctx, e, canUse);
  renderFacts(ctx, e);
  renderConnection(ctx, e, canUse);
  renderAccount(ctx, canUse);
  renderOps(ctx, e, canUse);
  renderRcDirs(ctx, e, canUse);
  renderSetup(ctx, e);
  renderHistory(ctx);
}

/* ---------- 概要 ---------- */

function renderState(ctx: EnvPageCtx, e: EnvStatus): void {
  const { s } = ctx;
  const rs = rows(e, s);
  const down = hostLiveness(s) === 'unresponsive';
  const own = down ? null : e.heartbeat;
  const rc = own?.rc_dirs;
  const rcSub = rc
    ? (() => {
        const run = rc.running.filter((r) => r.state === 'running').length;
        const err = rc.running.filter((r) => r.state === 'error').length;
        if (run === 0 && err === 0) return 'フォルダ別の起動なし';
        return `フォルダ別 ${run} 稼働${err ? ` · ${err} エラー` : ''}`;
      })()
    : '';
  const subs: Record<string, string> = {
    'Claude Code': own?.claude.last_restart
      ? `最終再起動 ${dayTimeLong(own.claude.last_restart, s.now)}`
      : '',
    'Remote Control': rcSub,
    Codex: '',
    エージェント: own
      ? `v${own.agent_version} · 起動 ${dayTimeLong(own.agent_started_at, s.now)}`
      : '',
    VM: e.vm_view?.ip ? `内部IP ${e.vm_view.ip}` : '',
  };
  // host にはスマートプラグ（電源・消費電力）のタイルを足す（docs/spec.md 6.1）。host が応答しなくても出す
  const tiles: (Row & { sub?: string })[] = [...rs];
  if (ctx.env === 'host' && s.plug_enabled) tiles.push(plugRow(s));
  $('state-rows').innerHTML = tiles
    .map(
      (r) =>
        html`<div class="tile">
          <span class="k">${r.label}</span>
          <span class="status s-${r.tone}"><span class="dot"></span>${r.value}</span>
          <span class="sub">${r.sub ?? subs[r.label] ?? ''}</span>
        </div>`,
    )
    .join('');
}

function renderMetrics(ctx: EnvPageCtx, e: EnvStatus): void {
  const { env, s } = ctx;
  const sh = shares(s)[env] ?? { cpu: null, mem: null, disk: null };
  const h = hostHeartbeat(s)?.host;
  const a = e.vm_view?.alloc;
  let subs: [string, string, string] = ['', '', ''];
  if (env === 'host' && h) {
    const vms = s.envs.map((x) => x.vm_view?.alloc).filter((x): x is NonNullable<typeof x> => !!x);
    const memVm = vms.reduce((acc, v) => acc + (v.mem_gb ?? 0), 0);
    const diskVm = vms.reduce((acc, v) => acc + (v.disk_gb ?? 0), 0);
    subs = [
      h.cpu_cores !== undefined ? `全 ${h.cpu_cores} コアを共有` : '',
      h.mem_total_gb !== undefined ? `約 ${h.mem_total_gb - memVm}GB 使える` : '',
      h.disk_total_gb !== undefined
        ? `約 ${Math.max(0, h.disk_total_gb - diskVm - DISK_RESERVE_GB)}GB 使える`
        : '',
    ];
  } else if (a) {
    subs = [
      a.cpu !== undefined ? `割り当て ${a.cpu} コア` : '',
      a.mem_gb !== undefined ? `割り当て ${a.mem_gb}GB` : '',
      a.disk_gb !== undefined ? `割り当て ${a.disk_gb}GB` : '',
    ];
  }
  const tile = (label: string, val: number | null, sub: string) =>
    html`<div class="tile">
      <span class="k">${label}</span>
      <span class="v">${val === null ? '—' : `${val}%`}</span>
      <div class="meter" role="img" aria-label="${label} ${val === null ? '不明' : `${val}%`}">
        <div class="${val !== null && val >= 85 ? 'hot' : 'p1'}" style="width: ${val ?? 0}%"></div>
      </div>
      <span class="sub">${sub}</span>
    </div>`;
  $('state-metrics').innerHTML =
    tile('CPU', sh.cpu, subs[0]) +
    tile('メモリ', sh.mem, subs[1]) +
    tile('ディスク', sh.disk, subs[2]);
  $('metric-note').textContent =
    env === 'host'
      ? s.envs.length > 1
        ? 'Mac mini 全体のうち、VM を除いた本体の分'
        : 'Mac mini 全体の値'
      : 'Mac mini 全体のうち、この VM の分';
}

/** 要対応：他のタブで直すものへの入口 */
function renderTodo(ctx: EnvPageCtx, e: EnvStatus, canUse: boolean): void {
  const { s } = ctx;
  const down = hostLiveness(s) === 'unresponsive';
  const own = down ? null : e.heartbeat;
  const items: { tone: string; text: string; href: string; right: string }[] = [];
  const setup = own?.setup;
  if (setup) {
    const sm = summarizeSetup(setup);
    if (sm.ng > 0)
      items.push({
        tone: 's-warn',
        text: `基礎設定 ${sm.ng} 件未完了`,
        href: '#setup',
        right: sm.manualNg.length ? `手動 ${sm.manualNg.length} 件` : '',
      });
  }
  if (canUse && own?.rc_dirs) {
    for (const r of own.rc_dirs.running) {
      if (r.state === 'error')
        items.push({
          tone: 's-bad',
          text: `${r.dir} の Remote Control がエラー`,
          href: '#rc',
          right: 'Remote Control',
        });
    }
  }
  if (e.active) {
    items.push({
      tone: 's-warn',
      text: e.active.status === 'running' ? '指示を実行中' : '指示を待機中',
      href: !canUse ? '#history' : RC_DIR_PENDING_LABEL[e.active.action] ? '#rc' : '#ops',
      right: !canUse ? '履歴' : RC_DIR_PENDING_LABEL[e.active.action] ? 'Remote Control' : '操作',
    });
  }
  if (own?.maintenance?.last_result === 'failed') {
    items.push({ tone: 's-bad', text: '夜間メンテナンスが失敗', href: '#history', right: '履歴' });
  }
  $('todo-body').innerHTML =
    items.length === 0
      ? html`<tr>
          <td class="empty" colspan="2">いまのところ対応は要りません</td>
        </tr>`
      : items
          .map(
            (i) =>
              html`<tr class="clickable" data-href="${i.href}">
                <td class="wrap-text">
                  <span class="status ${i.tone}"><span class="dot"></span>${i.text}</span>
                </td>
                <td class="r">
                  <a class="link muted" href="${i.href}">${i.right} ${raw(ICON_ARROW)}</a>
                </td>
              </tr>`,
          )
          .join('');
}

function renderFacts(ctx: EnvPageCtx, e: EnvStatus): void {
  const { env, s } = ctx;
  const h = hostHeartbeat(s)?.host;
  const down = hostLiveness(s) === 'unresponsive';
  const own = down ? null : e.heartbeat;
  const facts: [string, string][] = [];
  if (env === 'host' && h) {
    const vms = s.envs.map((x) => x.vm_view?.alloc).filter((a): a is NonNullable<typeof a> => !!a);
    const memVm = vms.reduce((a, v) => a + (v.mem_gb ?? 0), 0);
    const diskVm = vms.reduce((a, v) => a + (v.disk_gb ?? 0), 0);
    facts.push([
      '割り当て',
      `CPU 全${h.cpu_cores ?? '—'}コアを共有 · メモリ 約${h.mem_total_gb !== undefined ? h.mem_total_gb - memVm : '—'}GB · ディスク 約${
        h.disk_total_gb !== undefined ? h.disk_total_gb - diskVm - DISK_RESERVE_GB : '—'
      }GB`,
    ]);
    if (h.os_version) facts.push(['macOS', h.os_version]);
    if (h.tart_version) facts.push(['Tart', h.tart_version]);
    if (h.boot_at) facts.push(['起動', dayTimeLong(h.boot_at, s.now)]);
  }
  if (env === 'host' && s.plug_enabled) {
    const p = plugRow(s);
    facts.push(['電源プラグ', p.sub ? `${p.value} · ${p.sub}` : p.value]);
  }
  if (env !== 'host') {
    const a = e.vm_view?.alloc;
    facts.push([
      '割り当て',
      a
        ? `CPU ${a.cpu ?? '—'}コア · メモリ ${a.mem_gb ?? '—'}GB · ディスク ${a.disk_gb ?? '—'}GB`
        : '—',
    ]);
    if (e.vm_view?.ip) facts.push(['内部IP', e.vm_view.ip]);
    if (own && 'guest' in own) {
      const g = own.guest;
      if (g.disk_used_gb !== undefined && g.disk_total_gb !== undefined)
        facts.push(['VM の中のディスク', `${gb(g.disk_used_gb)} / ${gb(g.disk_total_gb)}`]);
      if (g.os_version) facts.push(['macOS', g.os_version]);
      if (g.boot_at) facts.push(['VM の起動', dayTimeLong(g.boot_at, s.now)]);
    }
  }
  const maint = own?.maintenance?.last_run_at
    ? `${dayTimeLong(own.maintenance.last_run_at, s.now)}（${MAINT[own.maintenance.last_result ?? ''] ?? own.maintenance.last_result ?? '—'}）`
    : '—';
  facts.push(['夜間メンテナンス', maint]);
  if (own)
    facts.push([
      'エージェント',
      `v${own.agent_version} · 起動 ${dayTimeLong(own.agent_started_at, s.now)}`,
    ]);
  $('facts').innerHTML = facts
    .map(
      ([k, v]) =>
        html`<tr>
          <td>${k}</td>
          <td class="num">${v}</td>
        </tr>`,
    )
    .join('');
}

/* ---------- 接続 ---------- */

function renderConnection(ctx: EnvPageCtx, e: EnvStatus, canUse: boolean): void {
  const { env } = ctx;
  const body = $('conn-body');
  if (!canUse) {
    body.innerHTML = '';
    return;
  }
  const ip = env === 'host' ? PEOPLE.host.fixedIp : e.vm_view?.ip;
  const ipText = ip ?? `[${env}の内部IP]`;
  // SSH の宛先ユーザーはそのマシンの利用者（見ている人ではない）。オーナーが入るときも同じ名前で入る
  const cmd = `ssh ${PEOPLE[env].login}@${ipText}`;
  // ファイルアプリ（iPhone の「ファイル」› サーバへ接続）。共有名は各マシンの ~/workspace を smb-workspace.sh で公開した `workspace`
  const smb = `smb://${ipText}/workspace`;
  // Mac 側の準備ができているか（基礎設定 sharing.smb_workspace）。host が応答しないときは不明
  const smbCheck =
    hostLiveness(ctx.s) === 'unresponsive'
      ? undefined
      : e.heartbeat?.setup?.find((c) => c.key === 'sharing.smb_workspace');
  const smbState =
    !smbCheck || smbCheck.status === 'skip'
      ? null
      : smbCheck.status === 'ok'
        ? { cls: 's-ok', text: '共有中' }
        : smbCheck.status === 'ng'
          ? { cls: 's-bad', text: `未準備：${smbCheck.detail ?? ''}` }
          : { cls: 's-none', text: '不明' };
  body.innerHTML = html`<div class="cols-2">
    <div class="panel">
      <div class="panel-head">
        <div class="t">
          <span class="badge-letter" aria-hidden="true">A</span>
          <h2>ブラウザで入る</h2>
          <span class="small muted">何も入れずに使えます</span>
        </div>
      </div>
      <div class="panel-body">
        <div class="routes">
          <a class="route" href="https://ssh-${env}.example.com" rel="noopener">
            <b>${raw(ICON_TERM)}SSH（ブラウザ）</b><span>ssh-${env}.example.com</span>
          </a>
          <a class="route" href="https://vnc-${env}.example.com" rel="noopener">
            <b>${raw(ICON_SCREEN)}画面共有（ブラウザ）</b><span>vnc-${env}.example.com</span>
          </a>
        </div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-head">
        <div class="t">
          <span class="badge-letter fill" aria-hidden="true">B</span>
          <h2>アプリで入る</h2>
          <span class="small muted">WARP をオンにしてから</span>
        </div>
      </div>
      <div class="panel-body" style="padding-top: 6px; padding-bottom: 6px">
        <p class="warp-note">
          <b>先に Cloudflare One（WARP）アプリをオンにしてください。</b>
          オフのままだと
          <code>192.168.64.x</code> には届きません。入れ方は使い方ガイドの「入り方」へ。
        </p>
        <div class="cmd">
          <span class="k">SSH アプリ</span><code>${cmd}</code>
          <button type="button" class="btn" data-copy="${cmd}">コピー</button>
        </div>
        <div class="cmd">
          <span class="k">VNC アプリ</span><code>${ipText}:5900</code>
          <button type="button" class="btn" data-vnc-pw>パスワードを表示</button>
        </div>
        <div class="cmd vnc-pw" id="vnc-pw" hidden></div>
        <div class="cmd">
          <span class="k">ファイルアプリ</span><code>${smb}</code>
          <button type="button" class="btn" data-copy="${smb}">コピー</button>
        </div>
        ${
          smbState
            ? html`<p class="note">
                <span class="status ${smbState.cls}"
                  ><span class="dot"></span>${smbState.text}</span
                >
                ${
                  smbState.cls === 's-bad'
                    ? html`<span class="muted"
                        >（Mac 側で
                        <code>sudo bash mac/scripts/smb-workspace.sh</code
                        >。基礎設定タブにも出ます）</span
                      >`
                    : ''
                }
              </p>`
            : ''
        }
        <p class="note">
          WARP をオンにしてから、iPhone の「ファイル」› … › サーバへ接続
          に上のアドレス。登録ユーザは
          <code>${PEOPLE[env].login}</code>、パスワードは Mac のログインパスワード。Wi‑Fi
          で無言で止まるときは 設定 › プライバシーとセキュリティ › ローカルネットワーク を確かめる。
        </p>
        ${
          ip
            ? ''
            : html`<p class="note">
                内部IPは host のエージェントが VM の状態と一緒に報告します（いまは未受信）。
              </p>`
        }
      </div>
      <div class="panel-foot">
        <a class="link muted" href="/guide/connect.html"
          >はじめての人は使い方ガイド（図解）へ ${raw(ICON_ARROW)}</a
        >
      </div>
    </div>
  </div>`;
}

/** アカウント：SSH の認証・入れる人・ログイン情報を 1 つの表に */
function renderAccount(ctx: EnvPageCtx, canUse: boolean): void {
  const { env, me } = ctx;
  const sec = $('login-sec');
  sec.hidden = !canUse;
  if (!canUse) return;
  const p = PEOPLE[env];
  // 本人の環境なら自分のメールから分かる。他人の環境（オーナーが見るとき）はサーバーに情報が無い
  const mine = me.role === 'member' ? me.envs.includes(env) : env === 'host';
  const open = explainOpen('login');
  const sub = (t: string) =>
    html`<span class="sub" data-explain-body="login" ${open ? '' : 'hidden'}>${t}</span>`;
  const items: [string, string][] = [
    [
      'Cloudflare Access',
      html`${mine ? me.email : '本人のメールアドレス'}${sub('ダッシュボード・SSH・画面共有で共通')}`,
    ],
    [
      'macOS ユーザー名',
      html`${PEOPLE[env].login}${sub('Access のメールの @ より前と同じにする')}`,
    ],
    ['SSH の認証', html`Cloudflare Access の短期証明書${sub('鍵の登録は不要')}`],
    [
      'このマシンに入れる人',
      html`<span class="who"
        ><span class="avatar sm" aria-hidden="true">${p.initial}</span>${p.name}<span class="sub"
          >利用者</span
        ></span
      >`,
    ],
    [
      `Claude（${p.account}）`,
      html`このマシン専用のアカウント${sub('メールとパスワードはパスワードマネージャーで')}`,
    ],
    [
      'Codex（ChatGPT）',
      html`このマシン専用のアカウント${sub('メールとパスワードはパスワードマネージャーで')}`,
    ],
    [
      'Remote Control の名前',
      html`<span class="mono">${env}-（セッション名）</span
        >${sub('Claude アプリのセッション一覧に出る名前')}`,
    ],
    [
      '作業フォルダ',
      html`この画面には表示しません${sub('ホーム直下は不可（信頼設定が保存されないため）')}`,
    ],
  ];
  $('login-body').innerHTML = items
    .map(
      ([k, v]) =>
        html`<tr>
          <td>${k}</td>
          <td>${raw(v)}</td>
        </tr>`,
    )
    .join('');
  $('ssh-policy').hidden = me.role !== 'owner';
}

/* ---------- 操作 ---------- */

function renderOps(ctx: EnvPageCtx, e: EnvStatus, canUse: boolean): void {
  const { env, me, serverOffset } = ctx;
  const sec = $('ops-sec');
  sec.hidden = !canUse;
  if (!canUse) return;
  const busy = !!e.active;
  const vmState = e.vm_view?.vm_state;
  const hostLive = hostLiveness(ctx.s);
  const open = explainOpen('ops');
  $('active-cmd').innerHTML = e.active
    ? activeBox(e.active, serverOffset, canOperate(me, env))
    : '';
  // Remote Control の権限モード（13章 #18）。heartbeat の値を見て、反対の値に切り替えるボタンを出す
  const mode = e.heartbeat?.claude.rc_permission_mode;
  const permAllowed = canOperate(me, env);
  const permRow = html`<tr>
    <td class="wrap-text">
      権限の確認を省く（bypassPermissions）
      <span class="meta"
        >${mode === undefined ? '（エージェントが未対応）' : mode === 'bypassPermissions' ? '現在：省く' : '現在：毎回確認する'}</span
      >
      <span class="d" data-explain-body="ops" ${open ? '' : 'hidden'}
        >オンにすると、Claude
        アプリでファイルの書き込みやコマンド実行のたびに許可を求めなくなります。この Mac は Claude
        専用なので既定はオンです。切り替えると Remote Control を立て直します。</span
      >
      ${!permAllowed ? html`<span class="why">本人かオーナーだけが切り替えられます</span>` : busy ? html`<span class="why waiting"><span class="spin" aria-hidden="true"></span>実行中の指示が終わるまで待ちます</span>` : ''}
    </td>
    <td class="r">
      <button
        type="button"
        class="btn wide"
        data-rc-perm="${mode === 'bypassPermissions' ? 'default' : 'bypassPermissions'}"
        ${busy || !permAllowed || mode === undefined ? 'disabled' : ''}
      >
        ${mode === 'bypassPermissions' ? 'オフにする' : 'オンにする'}
      </button>
    </td>
  </tr>`;
  // Claude Code 全体の既定の権限モード（13章 #20）。値は基礎設定の claude.default_bypass から読む
  // （ok = 省く、ng = 省かない、項目が無い = 古いエージェント）
  const dbp = e.heartbeat?.setup?.find((c) => c.key === 'claude.default_bypass');
  const claudeOn = dbp === undefined ? undefined : dbp.status === 'ok';
  const claudeUnknown = dbp === undefined || dbp.status === 'unknown' || dbp.status === 'skip';
  const claudePermRow = html`<tr>
    <td class="wrap-text">
      Claude Code の既定で権限の確認を省く
      <span class="meta"
        >${dbp === undefined ? '（エージェントが未対応）' : claudeUnknown ? '現在：不明' : claudeOn ? '現在：省く' : '現在：毎回確認する'}</span
      >
      <span class="d" data-explain-body="ops" ${open ? '' : 'hidden'}
        >ターミナルで claude を起動したときの既定です（~/.claude/settings.json）。オンにすると、
        ファイルの書き込みやコマンド実行のたびに許可を求めず、起動時の確認ダイアログも出ません。次に起動する
        claude から効き、動いている Remote Control
        は切れません。基礎設定ではオンが正しい状態です。</span
      >
      ${!permAllowed ? html`<span class="why">本人かオーナーだけが切り替えられます</span>` : busy ? html`<span class="why waiting"><span class="spin" aria-hidden="true"></span>実行中の指示が終わるまで待ちます</span>` : ''}
    </td>
    <td class="r">
      <button
        type="button"
        class="btn wide"
        data-claude-perm="${claudeOn ? 'default' : 'bypassPermissions'}"
        ${busy || !permAllowed || dbp === undefined ? 'disabled' : ''}
      >
        ${claudeOn ? 'オフにする' : 'オンにする'}
      </button>
    </td>
  </tr>`;
  const ops = opsFor(env);
  const normal = ops.filter((o) => !o.danger);
  const danger = ops.filter((o) => o.danger);
  const row = (op: (typeof ops)[number]) => {
    const allowed = canPress(me, env, op.action);
    let disabled = busy || !allowed;
    let why: string | Raw = '';
    if (!allowed) why = 'オーナーだけが実行できます';
    else if (busy) why = WAIT_NOTE;
    else if (op.action === 'host_power_cycle' && !ctx.s.plug_enabled) {
      disabled = true;
      why = 'スマートプラグが未設定です（Worker の secret）';
    } else if (
      op.action === 'host_power_cycle' &&
      hostLive !== 'unresponsive' &&
      hostLive !== 'unknown'
    ) {
      disabled = true;
      why = 'Mac mini からの報告が届いているあいだは使えません（先に「ホストを再起動」）';
    } else if (op.action === 'vm_start' && vmState === 'running') {
      disabled = true;
      why = 'すでに起動しています';
    } else if ((op.action === 'vm_stop' || op.action === 'vm_restart') && vmState === 'stopped') {
      disabled = true;
      why = 'VM は停止しています';
    } else if (
      op.action !== 'vm_start' &&
      op.action !== 'vm_stop' &&
      op.action !== 'vm_restart' &&
      env !== 'host' &&
      vmState === 'stopped'
    ) {
      disabled = true;
      why = 'VM が停止しているため実行できません';
    }
    return html`<tr class="${op.danger ? 'danger' : ''}">
      <td class="wrap-text">
        ${op.name}
        <span class="d" data-explain-body="ops" ${open ? '' : 'hidden'}>${op.desc}</span>
        ${
          disabled && why
            ? html`<span class="why${why instanceof Raw ? ' waiting' : ''}">${why}</span>`
            : ''
        }
      </td>
      <td class="r">
        <button
          type="button"
          class="btn wide ${op.danger ? 'danger' : ''}"
          data-op="${op.action}"
          ${disabled ? 'disabled' : ''}
        >
          ${op.button}
        </button>
      </td>
    </tr>`;
  };
  $('ops-body').innerHTML =
    permRow +
    claudePermRow +
    normal.map(row).join('') +
    (danger.length
      ? html`<tr class="group-row">
          <td colspan="2">危険な操作（オーナーだけ・最終確認あり）</td>
        </tr>` + danger.map(row).join('')
      : '');
}

/**
 * フォルダごとの Remote Control（heartbeat.rc_dirs）。本人・オーナーだけ。専用タブ（#rc）。
 * 作業フォルダ直下のフォルダをすべて並べ、行ごとに「起動」「停止」を出す（選択式にしない。いちばんよく使う場所）。起動は信頼の記録を含む
 */
function renderRcDirs(ctx: EnvPageCtx, e: EnvStatus, canUse: boolean): void {
  const { env, me, s, serverOffset } = ctx;
  const sec = $('rcdir-sec');
  sec.hidden = !canUse;
  if (!canUse) return;
  // 古い HTML（タブ新設前）を抱えたままの画面では無い。無ければ飛ばす（version.json の確認で再読み込みされる）
  const rcActive = document.getElementById('rc-active');
  if (rcActive)
    rcActive.innerHTML = e.active ? activeBox(e.active, serverOffset, canOperate(me, env)) : '';
  const down = hostLiveness(s) === 'unresponsive';
  const rc = down ? undefined : e.heartbeat?.rc_dirs;
  const body = $('rcdir-body');
  const exp = $('rcdir-explain');
  if (!rc) {
    exp.textContent =
      '作業フォルダの直下にあるフォルダごとに、そのフォルダを作業場所にした Remote Control を立ち上げられます。Claude アプリにはフォルダ名で表示されます。';
    body.innerHTML = html`<p class="empty">このエージェントは未対応</p>`;
    return;
  }
  exp.textContent =
    `一覧は作業フォルダ（${rc.root}）の直下にあるフォルダです。行の「起動」で、そのフォルダを作業場所にした Remote Control がもう 1 つ立ち上がります。Claude アプリにはフォルダ名で表示されます。` +
    '起動するときは、そのフォルダを Claude Code の信頼済みフォルダとして記録してから立ち上げます（git リポジトリはフォルダ単位で信頼が要るため。信頼すると、そのフォルダの CLAUDE.md・フック・設定が読み込まれます）。';

  const busy = !!e.active;
  const tone = (st: string) => (st === 'running' ? 's-ok' : st === 'error' ? 's-bad' : 's-none');
  const stateLabel: Record<string, string> = {
    running: '稼働中',
    starting: '起動中',
    stopped: '停止',
    error: 'エラー',
  };
  // 実行中の指示がフォルダ向けなら、そのフォルダの行に何をしている最中かを回転付きで出す
  const act = e.active;
  const pendingDir = act?.args?.dir && RC_DIR_PENDING_LABEL[act.action] ? act.args.dir : null;
  const pendingLabel =
    act && pendingDir
      ? act.action === 'rc_mkdir' && act.args?.start
        ? '作成して起動中'
        : (RC_DIR_PENDING_LABEL[act.action] ?? '')
      : '';
  const detailText = (d: string | undefined) =>
    d === 'not trusted'
      ? 'Claude Code がこのフォルダを信頼していません。「起動」を押すと信頼を記録してから起動し直します'
      : d;

  // 行の材料：動いている（希望している）フォルダ ＋ まだ起動していないフォルダ ＋ 作成中のフォルダ
  const byDir = new Map(rc.running.map((r) => [r.dir, r] as const));
  const names = new Set<string>([...rc.available, ...byDir.keys()]);
  if (pendingDir) names.add(pendingDir);
  const rank = (dir: string): number => {
    if (dir === pendingDir) return 0;
    const st = byDir.get(dir)?.state;
    return st === 'error'
      ? 1
      : st === 'running' || st === 'starting'
        ? 2
        : st === 'stopped'
          ? 3
          : 4;
  };
  const rows = [...names].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

  const btn = (label: string, attr: string) =>
    html`<button type="button" class="btn" ${raw(attr)} ${busy ? 'disabled' : ''}>
      ${label}
    </button>`;
  const row = (dir: string) => {
    const r = byDir.get(dir);
    const pending = dir === pendingDir;
    const state = pending
      ? html`<span class="status s-warn waiting"
          ><span class="spin" aria-hidden="true"></span>${pendingLabel}</span
        >`
      : r
        ? html`<span class="status ${tone(r.state)}"
            ><span class="dot"></span>${stateLabel[r.state] ?? r.state}</span
          >`
        : html`<span class="status s-none"><span class="dot"></span>未起動</span>`;
    const middle =
      r && r.state === 'error' && r.detail
        ? html`<td colspan="2" class="detail-bad hide-sm">${detailText(r.detail)}</td>`
        : html`<td class="mono muted hide-sm">${r?.name ?? '—'}</td>
            <td class="time hide-sm">
              ${r?.started_at ? dayTimeLong(r.started_at, s.now) : '—'}
            </td>`;
    const buttons = !r
      ? pending
        ? ''
        : btn('起動', `data-rc-start="${dir}"`)
      : (r.state === 'error' ? btn('起動', `data-rc-start="${dir}"`) : '') +
        btn('停止', `data-rc-stop="${dir}"`);
    return html`<tr>
      <td class="mono">${dir}</td>
      <td>${state}</td>
      ${raw(middle)}
      <td class="r"><div class="btn-row">${raw(buttons)}</div></td>
    </tr>`;
  };
  const list =
    rows.length === 0
      ? html`<p class="empty">
          作業フォルダ（${rc.root}）の直下にフォルダがありません。下の「新しいフォルダ」で作れます
        </p>`
      : html`<div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>フォルダ</th>
                <th>状態</th>
                <th class="hide-sm">Claude アプリでの名前</th>
                <th class="hide-sm">起動</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(row)}
            </tbody>
          </table>
        </div>`;

  // 新しいフォルダを作る（rc_mkdir）。入力中は再描画で消さない
  const mkform = html`<div class="rcdir-form">
    <label for="rcdir-new">新しいフォルダ</label>
    <input
      id="rcdir-new"
      type="text"
      maxlength="64"
      placeholder="例: my-project"
      autocomplete="off"
      spellcheck="false"
      ${busy ? 'disabled' : ''}
    />
    <label class="chk"
      ><input type="checkbox" id="rcdir-new-start" checked /> 作成後に Remote Control を起動</label
    >
    <button type="button" class="btn" data-rc-mkdir ${busy ? 'disabled' : ''}>作成</button>
  </div>`;
  const prevInput = document.getElementById('rcdir-new');
  const prevChk = document.getElementById('rcdir-new-start');
  if (prevInput && document.activeElement === prevInput) return;
  const keepName = prevInput instanceof HTMLInputElement ? prevInput.value : '';
  const keepStart = prevChk instanceof HTMLInputElement ? prevChk.checked : true;

  body.innerHTML = html`${raw(list)}${raw(mkform)}`;
  const inp = document.getElementById('rcdir-new');
  const chk = document.getElementById('rcdir-new-start');
  if (inp instanceof HTMLInputElement) inp.value = keepName;
  if (chk instanceof HTMLInputElement) chk.checked = keepStart;
}

/* ---------- 基礎設定 ---------- */

/** 未完了・未確認だけ常に出し、完了した項目は畳む。手動で ng の項目を先頭に */
function renderSetup(ctx: EnvPageCtx, e: EnvStatus): void {
  const { env, s } = ctx;
  const down = hostLiveness(s) === 'unresponsive';
  const setup = down ? undefined : e.heartbeat?.setup;
  const sum = $('setup-sum');
  const body = $('setup-body');
  const count = $('setup-count');
  if (!setup) {
    sum.innerHTML = '';
    count.hidden = true;
    body.innerHTML = html`<p class="empty">エージェントがまだ報告していません</p>`;
    return;
  }
  const sm = summarizeSetup(setup);
  sum.className = `status ${sm.ng > 0 ? 's-warn' : 's-ok'}`;
  sum.innerHTML = html`<span class="dot"></span>${sm.ok} / ${sm.total}
    OK${
      sm.ng > 0
        ? ` · 要対応 ${sm.ng}${sm.manualNg.length ? `（手動 ${sm.manualNg.length}）` : ''}`
        : ''
    }`;
  count.hidden = sm.ng === 0;
  count.className = 'count warn';
  count.textContent = String(sm.ng);

  const byKey = new Map(setup.map((c) => [c.key, c] as const));
  const ordered: SetupCheck[] = [];
  for (const k of setupKeysFor(env)) {
    const c = byKey.get(k);
    if (c && c.status !== 'skip') ordered.push(c);
  }
  // その環境の一覧に無いキーが届いていても捨てずに末尾へ
  for (const c of setup) {
    if (c.status !== 'skip' && !ordered.includes(c)) ordered.push(c);
  }
  const rank = (c: SetupCheck) =>
    c.status === 'ng' ? (SETUP_CHECK_SPECS[c.key]?.manual ? 0 : 1) : c.status === 'unknown' ? 2 : 3;
  ordered.sort((a, b) => rank(a) - rank(b));

  const tone = (st: SetupCheck['status']) =>
    st === 'ok' ? 's-ok' : st === 'ng' ? 's-bad' : 's-none';
  const line = (c: SetupCheck) => {
    const spec = SETUP_CHECK_SPECS[c.key];
    const label = spec?.label ?? c.key;
    return html`<div class="check ${tone(c.status)} ${c.status === 'ok' ? 'ok' : ''}">
      <span class="dot"></span>
      <span class="label">${label}${spec?.manual ? html`<span class="tag">手動</span>` : ''}</span>
      <span class="detail">${c.detail ?? (c.status === 'unknown' ? '未確認' : '')}</span>
      ${c.status === 'ng' && spec ? html`<span class="how"><b>直し方</b>${spec.how}</span>` : ''}
    </div>`;
  };
  const open = ordered.filter((c) => c.status !== 'ok');
  const done = ordered.filter((c) => c.status === 'ok');
  // 開閉の状態は再描画をまたいで保つ
  const wasOpen = body.querySelector('details')?.open ?? false;
  body.innerHTML = html`${open.length === 0 ? html`<p class="empty">すべて完了しています</p>` : raw(open.map(line).join(''))}
  ${
    done.length
      ? html`<details class="fold" ${wasOpen ? 'open' : ''}>
          <summary>完了した項目 ${done.length} 件</summary>
          ${raw(done.map(line).join(''))}
        </details>`
      : ''
  }`;
}

/* ---------- 履歴 ---------- */

function renderHistory(ctx: EnvPageCtx): void {
  const { env, s, audit } = ctx;
  if (!audit) return;
  const mine = audit.filter((a) => a.target === env);
  $('history-body').innerHTML =
    mine.length === 0
      ? html`<tr>
          <td colspan="4" class="empty">まだ操作はありません</td>
        </tr>`
      : mine
          .slice(0, 50)
          .map((a) => {
            const v = auditView(a, s.now);
            return html`<tr>
              <td class="time">${v.time}</td>
              <td>${v.op}</td>
              <td>${v.actor}</td>
              <td
                class="r ${v.resultTone === 'bad' ? 's-bad' : v.resultTone === 'muted' ? 'muted' : ''}"
              >
                ${v.result}
              </td>
            </tr>`;
          })
          .join('');
}
