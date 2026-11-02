import type { SessionRow } from '@macmini/shared';
import { html, raw } from './dom.js';
import { dayTime } from './format.js';

/** 確認ダイアログ。<dialog id="dlg"> を使い回す。 */

function dlg(): HTMLDialogElement {
  const d = document.getElementById('dlg');
  if (!(d instanceof HTMLDialogElement)) throw new Error('#dlg がない');
  return d;
}

function open(body: string): Promise<string> {
  const d = dlg();
  d.innerHTML = body;
  return new Promise((resolve) => {
    const onClose = () => {
      d.removeEventListener('close', onClose);
      resolve(d.returnValue);
      d.returnValue = '';
    };
    d.addEventListener('close', onClose);
    d.showModal();
  });
}

/** 1回の確認。true なら実行 */
export async function confirmDialog(opts: {
  title: string;
  body: string;
  okLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  const r = await open(html`
    <form method="dialog">
      <h2>${opts.title}</h2>
      <p>${opts.body}</p>
      <div class="actions">
        <button type="submit" value="cancel" class="btn">キャンセル</button>
        <button
          type="submit"
          value="ok"
          class="btn ${opts.danger ? 'danger' : 'primary'}"
          autofocus
        >
          ${opts.okLabel ?? '実行'}
        </button>
      </div>
    </form>
  `);
  return r === 'ok';
}

/** 2段階目：ホスト名「host」の入力。入力が一致したときだけ実行（ホスト再起動・電源の入れ直し） */
export async function hostnameDialog(opts: {
  title: string;
  note: string;
  okLabel: string;
}): Promise<boolean> {
  const r = await open(html`
    <form method="dialog">
      <h2>${opts.title}</h2>
      <p class="strong">確認のため、ホスト名 <code>host</code> を入力してください。</p>
      <p>${opts.note}</p>
      <input
        type="text"
        name="confirm"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        placeholder="host"
        aria-label="ホスト名"
      />
      <div class="actions">
        <button type="submit" value="cancel" class="btn">キャンセル</button>
        <button type="submit" value="ok" class="btn danger" id="dlg-ok" disabled>
          ${opts.okLabel}
        </button>
      </div>
    </form>
  `);
  return r === 'ok';
}

// 入力が "host" のときだけ「再起動を登録」を押せるようにする
document.addEventListener('input', (ev) => {
  const t = ev.target;
  if (!(t instanceof HTMLInputElement) || t.name !== 'confirm') return;
  const ok = t.form?.querySelector<HTMLButtonElement>('#dlg-ok');
  if (ok) ok.disabled = t.value.trim() !== 'host';
});

/** セッションを選ぶ。選ばなければ null */
export async function sessionDialog(sessions: SessionRow[], now: number): Promise<string | null> {
  if (sessions.length === 0) {
    await open(html`
      <form method="dialog">
        <h2>前のセッションを戻す</h2>
        <p>
          戻せるセッションが記録されていません。エージェントが Remote Control
          のセッションを報告すると、ここに出ます。
        </p>
        <div class="actions">
          <button type="submit" value="cancel" class="btn primary">閉じる</button>
        </div>
      </form>
    `);
    return null;
  }
  const items = sessions.map(
    (s, i) => html`
      <label>
        <input type="radio" name="session" value="${s.session_id}" ${i === 0 ? 'checked' : ''} />
        <span style="display: flex; flex-direction: column; gap: 2px">
          <span class="title">${s.title ?? '（タイトルなし）'}</span>
          <span class="meta">
            ${s.started_at ? `開始 ${dayTime(s.started_at, now)}` : '開始時刻 不明'} · ID
            ${s.session_id.slice(0, 8)}
          </span>
        </span>
      </label>
    `,
  );
  const d = dlg();
  const r = await open(html`
    <form method="dialog">
      <h2>前のセッションを戻す</h2>
      <p>戻すセッションを選んでください（止まってから約4時間以内のものだけ戻ります）。</p>
      <div class="session-list">${raw(items.join(''))}</div>
      <div class="actions">
        <button type="submit" value="cancel" class="btn">キャンセル</button>
        <button type="submit" value="ok" class="btn primary">このセッションを戻す</button>
      </div>
    </form>
  `);
  if (r !== 'ok') return null;
  const picked = d.querySelector<HTMLInputElement>('input[name="session"]:checked');
  return picked?.value ?? null;
}
