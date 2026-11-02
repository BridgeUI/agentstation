import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import type { RcPermissionMode } from '@agentstation/shared';

/**
 * Claude Code 全体の設定（~/.claude/settings.json）のうち、既定の権限モードだけを扱う（docs/spec.md 13章 #20）。
 *
 *   bypassPermissions: permissions.defaultMode = "bypassPermissions" と skipDangerousModePermissionPrompt = true
 *   default:           permissions.defaultMode = "default"（skipDangerousModePermissionPrompt は触らない）
 *
 * ほかのキー（env、hooks、permissions.allow など）はそのまま残す。中身はダッシュボードに送らない
 * （env に秘密が入っていることがあるため。送るのは判定結果だけ）。
 */

export type ClaudeSettingsEdit = { ok: true; text: string } | { ok: false; reason: string };

/** JSON の文字列（無ければ null）に権限モードを反映した新しい文字列を返す。壊れた JSON は書き換えない */
export function applyClaudePermissionMode(
  text: string | null,
  mode: RcPermissionMode,
): ClaudeSettingsEdit {
  let obj: Record<string, unknown> = {};
  if (text !== null && text.trim() !== '') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, reason: 'settings.json が JSON として読めない（書き換えなかった）' };
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, reason: 'settings.json の形が不正（書き換えなかった）' };
    }
    obj = parsed as Record<string, unknown>;
  }
  const permsRaw = obj.permissions;
  if (
    permsRaw !== undefined &&
    (typeof permsRaw !== 'object' || permsRaw === null || Array.isArray(permsRaw))
  ) {
    return { ok: false, reason: 'settings.json の permissions の形が不正（書き換えなかった）' };
  }
  const perms = { ...((permsRaw as Record<string, unknown> | undefined) ?? {}), defaultMode: mode };
  const next: Record<string, unknown> = { ...obj, permissions: perms };
  if (mode === 'bypassPermissions') next.skipDangerousModePermissionPrompt = true;
  return { ok: true, text: JSON.stringify(next, null, 2) + '\n' };
}

/** 基礎設定の判定材料：既定の権限モードと、確認ダイアログを省く設定 */
export interface ClaudeDefaultMode {
  /** 読めない・壊れているときは 'invalid'、ファイルが無いときは 'missing' */
  readable: 'ok' | 'missing' | 'invalid';
  defaultMode?: string;
  skipPrompt: boolean;
}

export function readClaudeDefaultMode(text: string | null): ClaudeDefaultMode {
  if (text === null) return { readable: 'missing', skipPrompt: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { readable: 'invalid', skipPrompt: false };
  }
  if (typeof parsed !== 'object' || parsed === null)
    return { readable: 'invalid', skipPrompt: false };
  const o = parsed as Record<string, unknown>;
  const perms = o.permissions;
  const dm =
    typeof perms === 'object' && perms !== null
      ? (perms as Record<string, unknown>).defaultMode
      : undefined;
  const out: ClaudeDefaultMode = {
    readable: 'ok',
    skipPrompt: o.skipDangerousModePermissionPrompt === true,
  };
  if (typeof dm === 'string') out.defaultMode = dm;
  return out;
}

/**
 * 一時ファイル → rename で置き換える。シンボリックリンク（dotfiles 管理など）なら実体を書き換える。
 * 既存ファイルのパーミッションを引き継ぐ（新規は 600）。
 */
export function writeClaudeSettings(path: string, text: string): void {
  let target = path;
  let mode = 0o600;
  try {
    if (lstatSync(path).isSymbolicLink()) target = realpathSync(path);
    mode = lstatSync(target).mode & 0o777;
  } catch {
    /* 無ければ新規 */
  }
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const tmp = `${target}.agentstation-tmp`;
  writeFileSync(tmp, text, { mode });
  renameSync(tmp, target);
}

export function readTextOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}
