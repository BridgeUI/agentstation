import { FORBIDDEN_PATTERNS } from '@agentstation/shared';

/**
 * 送信直前の自己チェック（docs/spec.md 3.6「5.」、CLAUDE.md 3）。
 * sessions を除いた JSON のキーと文字列値を FORBIDDEN_PATTERNS で検査し、
 * 引っかかったキーのパスだけを返す（値は返さない。ログにも出さない）。
 */
export function findForbidden(
  payload: unknown,
  exclude: readonly string[] = ['sessions'],
): string[] {
  const hits: string[] = [];
  walk(payload, '', hits, new Set(exclude));
  return hits;
}

function walk(value: unknown, path: string, hits: string[], excludeTop: Set<string>): void {
  if (typeof value === 'string') {
    if (FORBIDDEN_PATTERNS.some((p) => p.test(value))) hits.push(path || '(root)');
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${path}[${i}]`, hits, excludeTop));
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (path === '' && excludeTop.has(k)) continue;
      const next = path ? `${path}.${k}` : k;
      if (FORBIDDEN_PATTERNS.some((p) => p.test(k))) hits.push(next);
      walk(v, next, hits, excludeTop);
    }
  }
}

export const OUTPUT_MAX = 500;

/**
 * 結果の output 用の要約。パスらしきものを落とし、空白をまとめ、500 文字で切る。
 * それでも秘密情報らしき文字列が残れば本文を捨てて定型文にする。
 */
export function summarizeOutput(text: string, max: number = OUTPUT_MAX): string {
  let s = text
    .replace(/\/Users\/[^\s'"`]*/g, '<path>')
    .replace(/(?:\/[\w.@-]+){2,}/g, '<path>')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > max) s = s.slice(0, max - 1) + '…';
  if (FORBIDDEN_PATTERNS.some((p) => p.test(s)))
    return '出力に秘密情報らしき文字列が含まれたため省略';
  return s;
}
