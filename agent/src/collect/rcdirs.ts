import { readdirSync } from 'node:fs';
import { basename } from 'node:path';
import { isRcDirName, type RcDirRunning, type RcDirs } from '@agentstation/shared';

/**
 * フォルダを選んで起動する Remote Control の「起動できるフォルダ」一覧（docs/spec.md 13章 #13）。
 * 作業フォルダ（config の work_dir。実機では ~/workspace）直下のディレクトリ名だけを返す。
 * パスは絶対に載せない。root は作業フォルダの最後の要素（例: 'workspace'）。
 */
export const RC_DIRS_MAX = 100;

export type ReadDirNames = (dir: string) => string[] | null;

/** fs 依存の実体。ディレクトリだけを名前で返す。読めなければ null */
export const readDirNames: ReadDirNames = (dir) => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return null;
  }
};

/** 先頭ドットなどの不正名を除き、名前順、最大 100 件（純粋関数） */
export function filterAvailableDirs(names: readonly string[] | null): string[] {
  if (!names) return [];
  return [...new Set(names.filter((n) => isRcDirName(n) && !n.startsWith('.')))]
    .sort((a, b) => a.localeCompare(b))
    .slice(0, RC_DIRS_MAX);
}

export function rcRootName(workDir: string): string {
  return basename(workDir);
}

export function buildRcDirs(
  workDir: string,
  names: readonly string[] | null,
  running: RcDirRunning[],
): RcDirs {
  return { root: rcRootName(workDir), available: filterAvailableDirs(names), running };
}

export function collectRcDirs(
  workDir: string,
  running: RcDirRunning[],
  read: ReadDirNames = readDirNames,
): RcDirs {
  return buildRcDirs(workDir, read(workDir), running);
}
