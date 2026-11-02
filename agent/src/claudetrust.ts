/**
 * Claude Code のユーザー状態ファイル（~/.claude.json）のうち、2 つの「初回の答え」だけを扱う。
 *
 *   projects["<フォルダの実体パス>"].hasTrustDialogAccepted = true   … 「このフォルダを信頼しますか」に「はい」（13章 #21）
 *   remoteDialogSeen = true                                         … 「Enable Remote Control? (y/n)」に y（13章 #14・#23）
 *
 * どちらも対話起動で答えたときに claude 自身が書く項目（claude 2.1.316 の本体で確認）。
 * ほかのキー（oauth まわり、履歴、他のフォルダの項目など）はそのまま残す。中身はダッシュボードに送らない。
 * 項目が無ければ claude が新規に作るときと同じ最小の形で作る。
 *
 * メインの Remote Control は launchd 直起動で端末が無く、この 2 つに答えられない。そこでエージェントが起動時と
 * 「Remote Control を立て直す」のたびに、作業フォルダの信頼と同意を記録する（prepareMainRc。2026-11-01 オーナーの決定、13章 #23）。
 * 利用者の初期設定は `claude auth login` だけで済む。
 */

import { existsSync, realpathSync } from 'node:fs';
import { readTextOrNull, writeClaudeSettings } from './claudesettings.js';

/** 信頼の記録に使うもの（テストで差し替える） */
export interface TrustDeps {
  exists: (p: string) => boolean;
  /** 実体のパス（claude は realpath で項目を引く）。解決できなければそのまま */
  realpath: (p: string) => string;
  read: (p: string) => string | null;
  write: (p: string, text: string) => void;
}
export const realTrust: TrustDeps = {
  exists: existsSync,
  realpath: (p) => {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  },
  read: readTextOrNull,
  write: writeClaudeSettings,
};

export type ProjectTrustEdit =
  { ok: true; changed: boolean; text: string } | { ok: false; reason: string };

/** claude が projects の項目を新しく作るときの形に合わせる（不足分は claude 側が既定値で補う） */
const NEW_PROJECT_ENTRY = {
  allowedTools: [],
  mcpContextUris: [],
  mcpServers: {},
  enabledMcpjsonServers: [],
  disabledMcpjsonServers: [],
  hasTrustDialogAccepted: true,
  hasClaudeMdExternalIncludesApproved: false,
  hasClaudeMdExternalIncludesWarningShown: false,
} as const;

/** ~/.claude.json の文字列をオブジェクトに。無い・空なら {}。壊れていれば理由を返す */
function parseClaudeJson(
  text: string | null,
): { ok: true; obj: Record<string, unknown> } | { ok: false; reason: string } {
  if (text === null || text.trim() === '') return { ok: true, obj: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: '~/.claude.json が JSON として読めない（書き換えなかった）' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: '~/.claude.json の形が不正（書き換えなかった）' };
  }
  return { ok: true, obj: parsed as Record<string, unknown> };
}

/** JSON の文字列（無ければ null）に、path の信頼フラグを立てた新しい文字列を返す。壊れた JSON は書き換えない */
export function applyProjectTrust(text: string | null, path: string): ProjectTrustEdit {
  const p = parseClaudeJson(text);
  if (!p.ok) return p;
  const obj = p.obj;
  const projectsRaw = obj.projects;
  if (
    projectsRaw !== undefined &&
    (typeof projectsRaw !== 'object' || projectsRaw === null || Array.isArray(projectsRaw))
  ) {
    return { ok: false, reason: '~/.claude.json の projects の形が不正（書き換えなかった）' };
  }
  const projects = { ...((projectsRaw as Record<string, unknown> | undefined) ?? {}) };
  const entryRaw = projects[path];
  if (entryRaw !== undefined && (typeof entryRaw !== 'object' || entryRaw === null)) {
    return { ok: false, reason: '~/.claude.json のフォルダ項目の形が不正（書き換えなかった）' };
  }
  const entry = entryRaw as Record<string, unknown> | undefined;
  if (entry?.hasTrustDialogAccepted === true) {
    return { ok: true, changed: false, text: text ?? '' };
  }
  projects[path] = entry ? { ...entry, hasTrustDialogAccepted: true } : { ...NEW_PROJECT_ENTRY };
  const next: Record<string, unknown> = { ...obj, projects };
  return { ok: true, changed: true, text: JSON.stringify(next, null, 2) + '\n' };
}

/** Remote Control の初回同意（「Enable Remote Control? (y/n)」の y）。remoteDialogSeen = true を立てる */
export function applyRemoteControlConsent(text: string | null): ProjectTrustEdit {
  const p = parseClaudeJson(text);
  if (!p.ok) return p;
  if (p.obj.remoteDialogSeen === true) return { ok: true, changed: false, text: text ?? '' };
  return {
    ok: true,
    changed: true,
    text: JSON.stringify({ ...p.obj, remoteDialogSeen: true }, null, 2) + '\n',
  };
}

export type PrepareMainRcResult =
  { ok: true; trusted: boolean; consented: boolean } | { ok: false; reason: string };

/**
 * メインの Remote Control が端末なしで起動できるように、作業フォルダの信頼と Remote Control の同意を記録する。
 * 既に両方あれば何も書かない。作業フォルダが無ければ信頼は記録しない（同意だけ書く）。
 * 起動時と rc_restart のたびに呼ぶ（冪等）。
 */
export function prepareMainRc(
  deps: TrustDeps,
  claudeJsonFile: string,
  workDir: string,
): PrepareMainRcResult {
  let text = deps.read(claudeJsonFile);
  let trusted = false;
  let consented = false;
  if (deps.exists(workDir)) {
    const t = applyProjectTrust(text, deps.realpath(workDir));
    if (!t.ok) return t;
    if (t.changed) {
      text = t.text;
      trusted = true;
    }
  }
  const c = applyRemoteControlConsent(text);
  if (!c.ok) return c;
  if (c.changed) {
    text = c.text;
    consented = true;
  }
  if (trusted || consented) {
    try {
      deps.write(claudeJsonFile, text ?? '');
    } catch {
      return { ok: false, reason: '~/.claude.json を書けなかった' };
    }
  }
  return { ok: true, trusted, consented };
}
