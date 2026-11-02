import { execFile } from 'node:child_process';

/**
 * 外部コマンドの実行。必ず execFile（引数配列）で、シェルは経由しない（CLAUDE.md 2）。
 * 収集・操作のコードは Runner を受け取るので、テストでは出力文字列を返す偽の Runner を渡せる。
 */

export interface ExecResult {
  /** 終了コード。シグナルで終わった・起動できなかったときは null */
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface ExecOptions {
  timeoutMs?: number;
  cwd?: string;
}

export type Runner = (
  cmd: string,
  args: readonly string[],
  opts?: ExecOptions,
) => Promise<ExecResult>;

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_BUFFER = 4 * 1024 * 1024;

export const realRunner: Runner = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    execFile(
      cmd,
      [...args],
      {
        timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
      },
      (err, stdout, stderr) => {
        if (!err) {
          resolve({ code: 0, stdout: String(stdout), stderr: String(stderr), timedOut: false });
          return;
        }
        const e = err as Error & { code?: number | string; killed?: boolean; signal?: string };
        resolve({
          code: typeof e.code === 'number' ? e.code : null,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          timedOut: Boolean(e.killed) && e.signal === 'SIGTERM',
        });
      },
    );
  });

export function succeeded(r: ExecResult): boolean {
  return r.code === 0;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * ディスク使用量の df。APFS では `/` は読み出し専用のシステム・スナップショットで使用量が
 * 小さく出る（実機で 13GB / 460GB）ので、データボリュームを見る。無い環境では `/` に戻す。
 */
export const DATA_VOLUME = '/System/Volumes/Data';
export async function runDf(run: Runner): Promise<ExecResult> {
  const r = await run('/bin/df', ['-k', DATA_VOLUME]);
  return r.code === 0 ? r : run('/bin/df', ['-k', '/']);
}
