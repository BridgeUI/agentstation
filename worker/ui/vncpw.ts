import type { Env } from '@agentstation/shared';
import { ApiFailure, api } from './api.js';
import { html } from './dom.js';

/**
 * VNC パスワードの表示（docs/spec.md 13章 #16）。
 * ボタンを押したときだけ /api/vnc-password を呼び、画面に 60 秒だけ出して消す。
 * 値は画面の要素以外（状態・ログ・localStorage）には置かない。30 秒ごとの再描画でも消える。
 */
const HIDE_MS = 60_000;
let timer: number | undefined;

export async function showVncPassword(env: Env, button: HTMLElement): Promise<void> {
  const box = document.getElementById('vnc-pw');
  if (!box) return;
  button.setAttribute('disabled', '');
  try {
    const r = await api.vncPassword(env);
    box.innerHTML = html`<code>${r.password}</code>
      <button type="button" class="btn" data-copy="${r.password}">コピー</button>
      <span class="small muted">60 秒で消えます</span>`;
    box.hidden = false;
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      box.innerHTML = '';
      box.hidden = true;
    }, HIDE_MS);
  } catch (e) {
    box.innerHTML = html`<span class="small muted"
      >${e instanceof ApiFailure ? e.message : '取得できませんでした'}</span
    >`;
    box.hidden = false;
  } finally {
    button.removeAttribute('disabled');
  }
}
