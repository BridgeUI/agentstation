import type { AuditEntry, EnvStatus, MeResponse, StatusResponse } from '@macmini/shared';
import { summarizeSetup } from '@macmini/shared';
import { auditRows, eventLine } from './audit.js';
import { $, html, raw } from './dom.js';
import { ago, dayTime } from './format.js';
import {
  banners,
  hostHeartbeat,
  hostLiveness,
  judge,
  overall,
  plugRow,
  rows,
  shares,
} from './judge.js';
import { PEOPLE, shortOf } from './people.js';

/** 一覧（index.html）。環境は表、全体はタイル、履歴は最新 5 件（design/redesign/README.md 3章） */

const DISK_RESERVE_GB = 100; // macOS を安定させるため空けておく分（docs/spec.md 3.3）
const AUDIT_PREVIEW = 5;

export interface OverviewOpts {
  /** 「すべて表示」を押したあとは全件出す */
  auditAll: boolean;
}

export function renderOverview(
  s: StatusResponse,
  me: MeResponse,
  audit: AuditEntry[] | null,
  serverOffset: number,
  opts: OverviewOpts,
): void {
  void me;
  void serverOffset;
  const hb = hostHeartbeat(s)?.host;
  const spec = hb
    ? `CPU ${hb.cpu_cores ?? '—'}コア · メモリ ${hb.mem_total_gb ?? '—'}GB · SSD ${hb.disk_total_gb ?? '—'}GB`
    : null;
  const plug = s.plug_enabled ? plugRow(s) : null;
  const plugText = plug
    ? `電源プラグ ${plug.value}${s.plug?.ok && s.plug.watts !== null ? ` · ${s.plug.watts}W` : ''}`
    : null;
  $('hero-sub').innerHTML = html`<span>Mac mini · ${s.envs.length}環境</span
    ><span>最終受信 ${ago(s.host_received_at, s.now)}</span
    >${spec ? html`<span>${spec}</span>` : ''}${plugText ? html`<span>${plugText}</span>` : ''}`;
  const ov = overall(s);
  const pill = $('overall');
  pill.className = `pill s-${ov.tone}`;
  pill.innerHTML = html`<span class="dot"></span>${ov.label}`;

  renderBanners(s);
  $('env-body').innerHTML = s.envs.map((e) => envRow(e, s)).join('');
  renderUsage(s);
  renderAlloc(s);
  renderAudit(audit, s, opts.auditAll);
  renderEvents(s);
}

/** 注意は 1 行＋飛び先。本文は説明として折り返し行に */
export function bannerHtml(
  b: { level: 'warn' | 'error'; title: string; body: string },
  link?: { href: string; label: string },
): string {
  return html`<div class="banner ${b.level}" role="status">
    <span class="status s-${b.level === 'error' ? 'bad' : 'warn'}"><span class="dot"></span></span>
    <strong>${b.title}</strong>
    ${link ? html`<a class="link" href="${link.href}">${link.label} →</a>` : ''}
    ${b.body ? html`<span class="body">${b.body}</span>` : ''}
  </div>`;
}

function renderBanners(s: StatusResponse): void {
  const bs = banners(s);
  const bn = $('banners');
  bn.hidden = bs.length === 0;
  bn.innerHTML = bs
    .map((b) => {
      // 「Hanako（vm1）で…」のようにどの環境の話か分かるものは、その環境の画面へ
      const env = s.envs.map((x) => x.env).find((x) => b.title.includes(`（${x}）`));
      return bannerHtml(
        b,
        env ? { href: `/${env}.html`, label: `${PEOPLE[env].name} の環境を開く` } : undefined,
      );
    })
    .join('');
}

function envRow(e: EnvStatus, s: StatusResponse): string {
  const p = PEOPLE[e.env];
  const v = judge(e, s);
  const rs = rows(e, s);
  const sh = shares(s)[e.env] ?? { cpu: null, mem: null, disk: null };
  const pct = (n: number | null) => (n === null ? '—' : `${n}%`);
  const setup = e.heartbeat?.setup;
  const sm = setup ? summarizeSetup(setup) : null;
  const cell = (r: { value: string; tone: string }) =>
    html`<td class="hide-sm ${r.tone === 'ok' || r.tone === 'none' ? '' : `s-${r.tone}`}">
      ${r.value}
    </td>`;
  return html`<tr class="clickable" data-href="/${e.env}.html">
    <td>
      <span class="who"
        ><span class="avatar" aria-hidden="true">${p.initial}</span>
        <span class="n"
          ><b><a href="/${e.env}.html">${p.name}</a></b
          ><span>${e.env} · ${p.account} · ${ago(e.agent_received_at, s.now)}</span></span
        ></span
      >
    </td>
    <td>
      <span class="status s-${v.tone}"><span class="dot"></span>${v.label}</span>
      ${
        sm && sm.ng > 0
          ? html`<span class="small s-warn" style="display: block; margin-top: 2px"
              >基礎設定 ${sm.ng} 件未完了</span
            >`
          : ''
      }
    </td>
    ${raw(rs.map(cell).join(''))}
    <td class="r num">${pct(sh.cpu)}</td>
    <td class="r num">${pct(sh.mem)}</td>
    <td class="r num">${pct(sh.disk)}</td>
  </tr>`;
}

function renderUsage(s: StatusResponse): void {
  const sh = shares(s);
  const h = hostHeartbeat(s)?.host;
  const down = hostLiveness(s) === 'unresponsive' || !h;
  // 使っている環境だけ（VM は 0〜2 台）
  const order = s.envs.map((e) => e.env);
  const tiles = (['cpu', 'mem', 'disk'] as const).map((k) => {
    const label = { cpu: 'CPU', mem: 'メモリ', disk: 'ディスク' }[k];
    const vals = order.map((e) => sh[e]?.[k] ?? null);
    const known = vals.every((v) => v !== null) && !down;
    // 小数の足し算で 19.700000000000003 のようにならないよう 1 桁に丸める
    const total = known
      ? Math.round(vals.reduce<number>((a, v) => a + (v ?? 0), 0) * 10) / 10
      : null;
    let detail = '';
    if (h && k === 'mem' && h.mem_used_gb !== undefined && h.mem_total_gb !== undefined)
      detail = `${h.mem_used_gb.toFixed(1)} / ${h.mem_total_gb} GB`;
    if (h && k === 'disk' && h.disk_used_gb !== undefined && h.disk_total_gb !== undefined)
      detail = `${Math.round(h.disk_used_gb)} / ${h.disk_total_gb} GB`;
    if (k === 'cpu') detail = '使用';
    const segs = order.map((e, i) => ({ cls: PEOPLE[e].shade, w: known ? (vals[i] ?? 0) : 0 }));
    const parts = order.map((e, i) => `${PEOPLE[e].name} ${known ? vals[i] : '—'}`);
    if (total !== null) parts.push(`空き ${Math.max(0, 100 - total)}`);
    return html`<div class="tile">
      <span class="k">${label}</span>
      <span class="v"
        >${total === null ? '—' : `${total}%`}<small>${known ? detail : ''}</small></span
      >
      <div
        class="meter"
        role="img"
        aria-label="${label} ${total === null ? '不明' : `合計${total}%、${parts.join('、')}`}"
      >
        ${raw(segs.map((x) => `<div class="${x.cls}" style="width: ${x.w}%"></div>`).join(''))}
      </div>
      <span class="sub num">${parts.join(' · ')}</span>
    </div>`;
  });
  $('usage-card').innerHTML = html`<div class="tiles">${raw(tiles.join(''))}</div>`;
}

function renderAlloc(s: StatusResponse): void {
  const h = hostHeartbeat(s)?.host;
  // 使っている VM（0〜2 台）の割り当て
  const vms = s.envs
    .filter((e) => e.env !== 'host')
    .map((e) => ({ env: e.env, alloc: e.vm_view?.alloc }));
  const card = $('alloc-card');
  if (!h || vms.some((v) => !v.alloc)) {
    card.innerHTML = html`<p class="empty">配分は host の報告から表示します（未受信）</p>`;
    return;
  }
  const n = (v: number | undefined, unit: string) => (v === undefined ? '—' : `${v}${unit}`);
  const sum = (k: 'cpu' | 'mem_gb' | 'disk_gb'): number | undefined =>
    vms.every((v) => v.alloc?.[k] !== undefined)
      ? vms.reduce((a, v) => a + (v.alloc?.[k] ?? 0), 0)
      : undefined;
  const vmMem = sum('mem_gb');
  const vmDisk = sum('disk_gb');
  const vmCpu = sum('cpu');
  const hostMem =
    h.mem_total_gb !== undefined && vmMem !== undefined ? h.mem_total_gb - vmMem : undefined;
  const hostDisk =
    h.disk_total_gb !== undefined && vmDisk !== undefined
      ? Math.max(0, h.disk_total_gb - vmDisk - DISK_RESERVE_GB)
      : undefined;
  const hostCpu =
    h.cpu_cores !== undefined && vmCpu !== undefined
      ? vms.length === 0
        ? `全コア（${h.cpu_cores}）`
        : `全コアを共有（残り ${Math.max(0, h.cpu_cores - vmCpu)}）`
      : '—';
  const row = (name: string, cpu: string, mem: string, disk: string, muted = false) =>
    html`<tr class="${muted ? 'muted' : ''}">
      <td>${name}</td>
      <td class="r num">${cpu}</td>
      <td class="r num">${mem}</td>
      <td class="r num">${disk}</td>
    </tr>`;
  card.innerHTML = html`<table>
    <thead>
      <tr>
        <th></th>
        <th class="r">CPU</th>
        <th class="r">メモリ</th>
        <th class="r">ディスク</th>
      </tr>
    </thead>
    <tbody>
      ${raw(
        [
          row(
            'Mac mini 全体',
            n(h.cpu_cores, 'コア'),
            n(h.mem_total_gb, 'GB'),
            n(h.disk_total_gb, 'GB'),
          ),
          row(`${PEOPLE.host.name}（本体）`, hostCpu, n(hostMem, 'GB'), n(hostDisk, 'GB')),
          ...vms.map((v) =>
            row(
              shortOf(v.env),
              n(v.alloc?.cpu, 'コア'),
              n(v.alloc?.mem_gb, 'GB'),
              n(v.alloc?.disk_gb, 'GB'),
            ),
          ),
          row('空けておく分（macOS 用）', '—', '—', `${DISK_RESERVE_GB}GB`, true),
        ].join(''),
      )}
    </tbody>
  </table>`;
}

function renderAudit(audit: AuditEntry[] | null, s: StatusResponse, all: boolean): void {
  const foot = $('audit-foot');
  if (!audit) {
    foot.hidden = true;
    return;
  }
  const list = all ? audit : audit.slice(0, AUDIT_PREVIEW);
  $('audit-body').innerHTML = auditRows(list, s.now);
  const more = audit.length > AUDIT_PREVIEW;
  // セグメントで「イベント」を選んでいるときは main.ts 側が hidden にするので、ここでは件数だけ
  foot.dataset.hasMore = more ? '1' : '';
  $('audit-more').textContent = all
    ? '最新 5 件だけ表示'
    : `すべての履歴を表示（${audit.length}件）→`;
  if (!more) foot.hidden = true;
}

/** 最近のイベント（状態から導いたもの。イベントの保存 API は未実装） */
function renderEvents(s: StatusResponse): void {
  const ev: string[] = [];
  for (const b of banners(s)) ev.push(eventLine(dayTime(s.now, s.now), html`${b.title}`));
  for (const e of s.envs) {
    if (e.active) {
      const t = e.active.started_at ?? e.active.created_at;
      ev.push(eventLine(dayTime(t, s.now), html`${shortOf(e.env)}：${activeLabel(e)}`));
    }
    const m = e.heartbeat?.maintenance;
    if (m?.last_run_at && m.last_result && m.last_result !== 'ok') {
      ev.push(
        eventLine(
          dayTime(m.last_run_at, s.now),
          html`${shortOf(e.env)}の夜間メンテナンス：${MAINT[m.last_result] ?? m.last_result}`,
        ),
      );
    }
  }
  $('events').innerHTML =
    ev.length > 0 ? ev.join('') : html`<div class="empty">いまのところ問題はありません</div>`;
}

export const MAINT: Record<string, string> = {
  ok: '正常',
  updated: '更新あり',
  busy: '作業中のため見送り',
  failed: '失敗',
  skipped: '見送り',
};

function activeLabel(e: EnvStatus): string {
  const c = e.active;
  if (!c) return '';
  return c.status === 'running' ? '指示を実行中' : '指示を待機中';
}
