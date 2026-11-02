import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  isRcPermissionMode,
  RC_PERMISSION_MODE_DEFAULT,
  type RcPermissionMode,
} from '@agentstation/shared';

/**
 * Remote Control の起動設定（~/.config/agentstation/rc.json。docs/spec.md 13章 #18）。
 * claude-rc.sh（launchd のメイン RC）と rcdirs/manager.ts（フォルダごとの RC）が同じファイルを読む。
 *
 *   { "permission_mode": "bypassPermissions" }
 *
 * ファイルが無い・読めない・値が不正なときは RC_PERMISSION_MODE_DEFAULT（bypassPermissions。
 * この Mac は Claude 専用という オーナーの決定）。秘密情報は入れない。
 */
export interface RcSettings {
  permission_mode: RcPermissionMode;
}

export function parseRcSettings(text: string | null): RcSettings {
  const out: RcSettings = { permission_mode: RC_PERMISSION_MODE_DEFAULT };
  if (text === null) return out;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return out;
  }
  if (typeof raw !== 'object' || raw === null) return out;
  const mode = (raw as Record<string, unknown>).permission_mode;
  if (isRcPermissionMode(mode)) out.permission_mode = mode;
  return out;
}

export function readRcSettings(path: string): RcSettings {
  let text: string | null = null;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    text = null;
  }
  return parseRcSettings(text);
}

/** 書き込みは一時ファイル → rename（途中で落ちても壊れない）。600 で置く */
export function writeRcSettings(path: string, settings: RcSettings): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, path);
}
