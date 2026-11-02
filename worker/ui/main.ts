import type { AuditEntry, Env, MeResponse, StatusResponse } from '@macmini/shared';
import { isEnv } from '@macmini/shared';
import { ApiFailure, api } from './api.js';
import {
  cancelOp,
  opsFor,
  runDirOp,
  runMkdirOp,
  runOp,
  runPermissionOp,
  runClaudePermissionOp,
} from './commands.js';
import { showVncPassword } from './vncpw.js';
import { $, setupExplainButtons, show } from './dom.js';
import { renderEnvPage } from './envpage.js';
import { renderOverview } from './overview.js';

/**
 * 画面の入口。body の data-page で分岐する。
 * - 起動時に /api/me、その後 /api/status（と /api/audit）を表示中は 5 秒ごと（非表示のタブは 60 秒）に取り直す
 * - 「最終受信 n秒前」はサーバーの now と received_at の差（端末の時計を使わない）
 */

declare const __BUILD_ID__: string;

/**
 * 配信中の画面が自分より新しければ再読み込みする（scripts/build-ui.mjs が version.json に同じ id を書く）。
 * ホーム画面のアプリは前面に戻っても再読み込みされないので、古い app.js のまま新しい画面を扱えないことがある。
 * 起動時と前面に戻ったとき、それと 10 分ごとに見る。確認できないときは何もしない
 */
let reloadedFor: string | null = null;
async function checkBuild(): Promise<void> {
  try {
    const res = await fetch('/version.json', { cache: 'no-store' });
    if (!res.ok) return;
    const body = (await res.json()) as { build?: unknown };
    const build = typeof body.build === 'string' ? body.build : null;
    if (!build || build === __BUILD_ID__ || reloadedFor === build) return;
    reloadedFor = build;
    location.reload();
  } catch {
    /* オフラインなど。次の機会に */
  }
}
const BUILD_CHECK_MS = 10 * 60 * 1000;

/** 表示中は 5 秒ごとに取り直す（エージェントも画面が見られている間は 5 秒ごとに報告する）。非表示のタブは 60 秒 */
const POLL_MS = 5_000;
const POLL_HIDDEN_MS = 60_000;

interface State {
  me: MeResponse;
  status: StatusResponse | null;
  audit: AuditEntry[] | null;
  /** サーバーの now − 端末の Date.now() */
  serverOffset: number;
  /** 一覧の「すべての履歴を表示」を押したか */
  auditAll: boolean;
}

/** 各環境の画面のタブ（URL のハッシュ）。無いハッシュは概要に倒す */
const TABS = ['overview', 'rc', 'connect', 'ops', 'setup', 'history'] as const;

function selectTab(): void {
  const tabs = Array.from(document.querySelectorAll<HTMLAnchorElement>('.tabs a[data-tab]'));
  if (tabs.length === 0) return;
  const want = location.hash.slice(1);
  const visible = (id: string) => !tabs.find((t) => t.dataset.tab === id)?.hidden;
  // ハッシュが無ければ、操作できる人は Remote Control（いちばんよく使う）、閲覧者は概要
  const fallback = visible('rc') ? 'rc' : 'overview';
  const id = (TABS as readonly string[]).includes(want) && visible(want) ? want : fallback;
  for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.tab === id));
  for (const p of document.querySelectorAll<HTMLElement>('.tabpanel')) p.hidden = p.id !== id;
}

/** セグメント（使用量／配分、操作履歴／イベント）。選択は localStorage に覚える */
function setupSegments(): void {
  for (const seg of document.querySelectorAll<HTMLElement>('[data-seg]')) {
    const key = seg.dataset.seg ?? '';
    const apply = (value: string) => {
      for (const b of seg.querySelectorAll<HTMLButtonElement>('[data-seg-value]'))
        b.setAttribute('aria-pressed', String(b.dataset.segValue === value));
      for (const p of document.querySelectorAll<HTMLElement>('[data-seg-panel]')) {
        const [k, v] = (p.dataset.segPanel ?? '').split(':');
        if (k !== key) continue;
        p.hidden = v !== value;
        // 履歴の「すべて表示」行は、出す履歴があるときだけ
        if (p.id === 'audit-foot' && v === value) p.hidden = !p.dataset.hasMore;
      }
    };
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(`seg:${key}`);
    } catch {
      /* 使えなくてもよい */
    }
    const first = seg.querySelector<HTMLButtonElement>('[data-seg-value]')?.dataset.segValue ?? '';
    apply(saved ?? first);
    seg.addEventListener('click', (ev) => {
      const b =
        ev.target instanceof Element
          ? ev.target.closest<HTMLButtonElement>('[data-seg-value]')
          : null;
      if (!b) return;
      const v = b.dataset.segValue ?? '';
      apply(v);
      try {
        localStorage.setItem(`seg:${key}`, v);
      } catch {
        /* 使えなくてもよい */
      }
    });
  }
}

const page = document.body.dataset.page ?? '';
const envAttr = document.body.dataset.env;
const pageEnv: Env | null = envAttr && isEnv(envAttr) ? envAttr : null;

let state: State | null = null;
let timer: number | undefined;

async function boot(): Promise<void> {
  setupExplainButtons();
  registerServiceWorker();
  if (page === 'guide') {
    // ガイドはログインの確認だけ。使っていない VM へのリンクを隠す（取れなければそのまま）
    api.me().then(
      (m) => applyEnabledEnvs(m.enabled_envs),
      () => undefined,
    );
    return;
  }

  let me: MeResponse;
  try {
    me = await api.me();
  } catch (e) {
    fail(e);
    return;
  }
  applyEnabledEnvs(me.enabled_envs);
  if (pageEnv && !me.enabled_envs.includes(pageEnv)) {
    showUnusedEnv(pageEnv);
    return;
  }
  state = { me, status: null, audit: null, serverOffset: 0, auditAll: false };
  // Slack のテスト通知はオーナーだけ（判定の本体はサーバー側。ここは出し分けだけ）
  const notifyBtn = document.getElementById('notify-test');
  if (notifyBtn && me.role === 'owner') notifyBtn.hidden = false;
  wireActions();
  setupSegments();
  addEventListener('hashchange', selectTab);
  await refresh();
  // host_restart のカウントダウンなど、1秒ごとに描き直す
  window.setInterval(() => {
    const active = state?.status?.envs.some((e) => e.active?.not_before);
    if (active) render();
  }, 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void checkBuild();
      void refresh();
    }
  });
  void checkBuild();
  window.setInterval(() => void checkBuild(), BUILD_CHECK_MS);
}

async function refresh(): Promise<void> {
  if (!state) return;
  window.clearTimeout(timer);
  try {
    const [status, audit] = await Promise.all([api.status(), api.audit(50).catch(() => null)]);
    state.status = status;
    state.audit = audit;
    state.serverOffset = status.now - Date.now();
    show($('load-error'), false);
    render();
  } catch (e) {
    fail(e);
  }
  timer = window.setTimeout(() => void refresh(), document.hidden ? POLL_HIDDEN_MS : POLL_MS);
}

function render(): void {
  if (!state?.status) return;
  const { me, status, audit, serverOffset, auditAll } = state;
  if (page === 'index') {
    renderOverview(status, me, audit, serverOffset, { auditAll });
    // 「すべて表示」行の出し分け（セグメントが操作履歴のときだけ）
    const foot = document.getElementById('audit-foot');
    const seg = document.querySelector<HTMLButtonElement>('[data-seg="log"] [aria-pressed="true"]');
    if (foot) foot.hidden = !foot.dataset.hasMore || seg?.dataset.segValue !== 'audit';
  } else if (page === 'env' && pageEnv) {
    renderEnvPage({ env: pageEnv, me, s: status, audit, serverOffset });
    selectTab();
  }
}

/**
 * 使っていない VM（MEMBERS_JSON.envs に無いもの。VM は 0〜2 台）へのリンクを隠す。
 * ナビ・下のタブバー・ガイドの中の「/vm1.html」へのリンクと、data-env-only="vm1" の要素が対象。
 */
function applyEnabledEnvs(enabled: readonly Env[]): void {
  for (const env of ['vm1', 'vm2'] as const) {
    if (enabled.includes(env)) continue;
    for (const el of document.querySelectorAll<HTMLElement>(
      `a[href="/${env}.html"], a[href^="/${env}.html#"], [data-env-only="${env}"]`,
    ))
      el.hidden = true;
  }
}

/** 使っていない環境の画面を開いたとき（ブックマークなど） */
function showUnusedEnv(env: Env): void {
  const main = document.querySelector<HTMLElement>('main');
  if (!main) return;
  main.innerHTML = `<section class="panel"><div class="panel-head"><h2>${env} は使っていません</h2></div>
    <p class="empty">この導入では ${env} を使う設定になっていません（MEMBERS_JSON の envs に無い）。<a href="/">一覧に戻る</a></p></section>`;
}

function fail(e: unknown): void {
  const el = $('load-error');
  const msg =
    e instanceof ApiFailure
      ? e.status === 401
        ? 'ログインが切れています。ページを再読み込みして、Cloudflare Access にログインし直してください。'
        : `状態を取得できません：${e.message}`
      : '状態を取得できません';
  el.textContent = msg;
  show(el, true);
}

/** ボタンのクリックは document で受ける（描き直しても付け直さないで済む） */
function wireActions(): void {
  document.addEventListener('click', (ev) => {
    const t =
      ev.target instanceof Element
        ? ev.target.closest<HTMLElement>(
            '[data-op],[data-cancel],[data-copy],[data-rc-start],[data-rc-stop],[data-rc-mkdir],[data-rc-perm],[data-claude-perm],[data-vnc-pw],[data-notify-test],[data-audit-more],tr[data-href]',
          )
        : null;
    if (!t || !state?.status) return;

    if (t.dataset.rcPerm && pageEnv) {
      const mode = t.dataset.rcPerm === 'bypassPermissions' ? 'bypassPermissions' : 'default';
      pending(t, async () => {
        const r = await runPermissionOp(pageEnv, mode);
        showOpError(r.message);
        if (r.ok) await refresh();
      });
      return;
    }
    if (t.dataset.claudePerm && pageEnv) {
      const mode = t.dataset.claudePerm === 'bypassPermissions' ? 'bypassPermissions' : 'default';
      pending(t, async () => {
        const r = await runClaudePermissionOp(pageEnv, mode);
        showOpError(r.message);
        if (r.ok) await refresh();
      });
      return;
    }
    if (t.dataset.vncPw !== undefined && pageEnv) {
      void showVncPassword(pageEnv, t);
      return;
    }
    if (t.dataset.notifyTest !== undefined) {
      pending(t, () => sendNotifyTest());
      return;
    }
    if (t.dataset.auditMore !== undefined) {
      state.auditAll = !state.auditAll;
      render();
      return;
    }
    if (t instanceof HTMLTableRowElement && t.dataset.href) {
      // 行のリンクやボタンを押したときはそちらに任せる
      if (ev.target instanceof Element && ev.target.closest('a,button')) return;
      location.href = t.dataset.href;
      return;
    }

    if (t.dataset.copy !== undefined) {
      void copy(t, t.dataset.copy);
      return;
    }
    if (t.dataset.op && pageEnv) {
      const op = opsFor(pageEnv).find((o) => o.action === t.dataset.op);
      if (!op) return;
      pending(t, async () => {
        const r = await runOp(pageEnv, op, Date.now() + (state?.serverOffset ?? 0));
        showOpError(r.message);
        if (r.ok) await refresh();
      });
      return;
    }
    if (t.dataset.rcStart && pageEnv) {
      // フォルダの行の「起動」（信頼の記録を含む）
      const dir = t.dataset.rcStart;
      pending(t, async () => {
        const r = await runDirOp(pageEnv, 'rc_start_dir', dir);
        showOpError(r.message, 'rcdir-error');
        if (r.ok) await refresh();
      });
      return;
    }
    if (t.dataset.rcMkdir !== undefined && pageEnv) {
      const inp = document.getElementById('rcdir-new');
      const chk = document.getElementById('rcdir-new-start');
      const dir = inp instanceof HTMLInputElement ? inp.value.trim() : '';
      const start = chk instanceof HTMLInputElement ? chk.checked : false;
      pending(t, async () => {
        const r = await runMkdirOp(pageEnv, dir, start);
        showOpError(r.message, 'rcdir-error');
        if (r.ok) {
          // ダイアログを待つ間に再描画が入ると inp は古い要素なので、取り直してから空にする
          const now = document.getElementById('rcdir-new');
          if (now instanceof HTMLInputElement) now.value = '';
          await refresh();
        }
      });
      return;
    }
    if (t.dataset.rcStop && pageEnv) {
      const dir = t.dataset.rcStop;
      pending(t, async () => {
        const r = await runDirOp(pageEnv, 'rc_stop_dir', dir);
        showOpError(r.message, 'rcdir-error');
        if (r.ok) await refresh();
      });
      return;
    }
    if (t.dataset.cancel) {
      const id = t.dataset.cancel;
      const c = state.status.envs.map((e) => e.active).find((a) => a?.id === id);
      if (!c) return;
      pending(t, async () => {
        const r = await cancelOp(c);
        showOpError(r.message);
        if (r.ok) await refresh();
      });
    }
  });
}

/**
 * 押したボタンを「送信中」（回転＋無効）にして fn を待つ。確認ダイアログ → API → 再描画までを覆う。
 * 再描画でボタンが差し替わればそのまま。差し替わらなかった（取り消し・失敗）ときは元に戻す
 */
function pending(btn: HTMLElement, fn: () => Promise<void>): void {
  if (!(btn instanceof HTMLButtonElement) || btn.disabled) {
    void fn();
    return;
  }
  const label = btn.innerHTML;
  btn.disabled = true;
  btn.classList.add('is-busy');
  btn.innerHTML = '<span class="spin" aria-hidden="true"></span>' + label;
  void fn().finally(() => {
    if (!btn.isConnected) return;
    btn.disabled = false;
    btn.classList.remove('is-busy');
    btn.innerHTML = label;
  });
}

/** Slack のテスト通知。結果はボタンの横に短く出す（Webhook の URL は画面に来ない） */
async function sendNotifyTest(): Promise<void> {
  const out = document.getElementById('notify-test-result');
  if (out) out.textContent = '送信中…';
  try {
    await api.notifyTest();
    if (out) out.textContent = 'Slack に送りました。チャンネルを確認してください';
    await refresh();
  } catch (e) {
    if (out) out.textContent = e instanceof ApiFailure ? e.message : '送れませんでした';
  }
}

function showOpError(msg: string | undefined, id = 'op-error'): void {
  const el = document.getElementById(id);
  if (!el) {
    if (msg) window.alert(msg);
    return;
  }
  el.textContent = msg ?? '';
  el.hidden = !msg;
}

async function copy(btn: HTMLElement, text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    const prev = btn.textContent;
    btn.textContent = 'コピーしました';
    window.setTimeout(() => {
      btn.textContent = prev;
    }, 1500);
  } catch {
    window.prompt('コピーしてください', text);
  }
}

/** PWA（ホーム画面に追加）用。/api/* はキャッシュしない（public/sw.js）。失敗しても画面には影響しない */
function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return; // 開発中は古い app.js を掴まないよう登録しない
  navigator.serviceWorker.register('/sw.js').catch(() => {
    /* 登録できなくてもよい */
  });
}

void boot();
