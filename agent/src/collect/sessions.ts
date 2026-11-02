import { SESSION_TITLE_MAX, type SessionInfo } from '@agentstation/shared';
import { readTail } from './rclog.js';

/**
 * Remote Control のセッション一覧（復元用）。`--debug-file` のログから拾う。
 *
 * 実機で確認した行の形（docs/verify.md C-2 の材料、2026-10-31）：
 *   [bridge:session] sessionId=<id> pid=…
 *   [bridge:session] Child args: … --session-id cse_… …
 *   [bridge:title] server title for session_…: <名前>
 * ID は `sessionId=` / `--session-id` / `server title for` の 3 か所から取る。
 * TODO(docs/verify.md C-2): `session_…` と `cse_…` が同じセッションを指すかは未確認。ここでは別の ID として
 * 扱い、どちらも載せる。開始時刻の取り方も未確認なので started_at は載せない。
 * 約束（docs/spec.md 9章）：タイトルは 60 文字まで、ファイル名・パス・会話本文は返さない。
 */
export const SESSION_ID_RE = /^[A-Za-z0-9_-]{4,128}$/;
export const SESSIONS_MAX = 10;

const ID_PATTERNS: readonly RegExp[] = [
  /\[bridge:session\][^\n]*?\bsessionId=([A-Za-z0-9_-]+)/,
  /\[bridge:session\][^\n]*?--session-id[ =]([A-Za-z0-9_-]+)/,
];
const TITLE_PATTERN = /\[bridge:title\] server title for ([A-Za-z0-9_-]+):\s*(.*?)\s*$/;

/** ログ本文からセッションを集める（純粋関数）。新しいものが先 */
export function parseSessionsFromLog(text: string): SessionInfo[] {
  const order: string[] = [];
  const titles = new Map<string, string>();
  const seen = new Set<string>();
  const touch = (id: string): void => {
    if (!SESSION_ID_RE.test(id)) return;
    if (seen.has(id)) order.splice(order.indexOf(id), 1);
    seen.add(id);
    order.push(id);
  };
  for (const line of text.split(/\r?\n/)) {
    for (const p of ID_PATTERNS) {
      const m = p.exec(line);
      if (m?.[1]) touch(m[1]);
    }
    const t = TITLE_PATTERN.exec(line);
    if (t?.[1] && SESSION_ID_RE.test(t[1])) {
      touch(t[1]);
      if (t[2]) titles.set(t[1], [...t[2]].slice(0, SESSION_TITLE_MAX).join(''));
    }
  }
  return order
    .reverse()
    .slice(0, SESSIONS_MAX)
    .map((id) => {
      const s: SessionInfo = { id };
      const title = titles.get(id);
      if (title) s.title = title;
      return s;
    });
}

/** 既定 RC と追加 RC のログをまとめて読む。同じ ID は先に出たもの（新しいログ）を優先 */
export async function listSessions(
  logPaths: readonly string[],
  read: (path: string) => string = readTail,
): Promise<SessionInfo[]> {
  const out: SessionInfo[] = [];
  const seen = new Set<string>();
  for (const p of logPaths) {
    for (const s of parseSessionsFromLog(read(p))) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      out.push(s);
    }
  }
  return out.slice(0, SESSIONS_MAX);
}
