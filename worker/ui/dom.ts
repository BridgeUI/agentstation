/** 小さな DOM の道具。文字列は必ずエスケープして流し込む。 */

export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 信頼済みの HTML 断片。html`` の戻り値と raw() がこれになる。
 * String を継承しているので、innerHTML への代入・連結・join はそのまま使える。
 * TypeScript 上は string として扱う（html の戻り値の型を参照）。
 */
export class Raw extends String {
  constructor(s: unknown) {
    super(String(s ?? ''));
  }
}
export const raw = (s: unknown): Raw => (s instanceof Raw ? s : new Raw(s));

/**
 * タグ付きテンプレート。${} の値はエスケープし、html`` の戻り値と raw() で包んだものだけそのまま入れる。
 * 戻り値は実体は Raw（String の子）。型の上では string にしておき、呼び出し側をそのまま書けるようにする。
 */
export function html(strings: TemplateStringsArray, ...vals: unknown[]): string {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) {
      const v = vals[i];
      if (v instanceof Raw) out += v.valueOf();
      else if (Array.isArray(v))
        out += v.map((x) => (x instanceof Raw ? x.valueOf() : esc(x))).join('');
      else out += esc(v);
    }
  });
  return new Raw(out) as unknown as string;
}

export function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} がない`);
  return el;
}

export function $$<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(sel));
}

export function show(el: HTMLElement, on: boolean): void {
  el.hidden = !on;
}

/**
 * 「説明」ボタン。data-explain="key" のボタンを押すと data-explain-body="key" の要素を開閉する。
 * 常に見せるのは見出し・数値・状態・ボタン・警告だけ（CLAUDE.md）。
 */
export function setupExplainButtons(): void {
  for (const btn of $$<HTMLButtonElement>('button[data-explain]')) {
    const key = btn.dataset.explain ?? '';
    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      const label = btn.querySelector('span');
      if (label) label.textContent = open ? '説明を閉じる' : '説明';
      for (const body of $$(`[data-explain-body="${key}"]`)) body.hidden = !open;
    });
  }
}

/** 説明の開閉状態（再描画後も維持するため） */
export function explainOpen(key: string): boolean {
  const btn = document.querySelector(`button[data-explain="${key}"]`);
  return btn?.getAttribute('aria-expanded') === 'true';
}

export const ICON_INFO =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
export const ICON_ARROW =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>';
export const ICON_TERM =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>';
export const ICON_SCREEN =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="1"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>';
