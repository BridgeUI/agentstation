import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { isRcDirName, type RcDirRunning, type RcDirState } from '@macmini/shared';
import type { Logger } from '../log.js';

/**
 * フォルダを選んで起動する追加の Remote Control（docs/spec.md 13章 #13）。
 * エージェントの子プロセスとして
 *   claude remote-control --name <dir> --debug-file ~/Library/Logs/claude-rc-<dir>.log
 * を cwd=work_dir/<dir> で起動する（spawn の引数配列。シェルは使わない）。
 *
 * - dir は isRcDirName で再検証し、path.resolve が work_dir 配下であることも確かめる
 * - 終了したら 30 秒後に再起動。1 時間に 5 回まで。超えたら error
 * - 「Workspace not trusted」で終了したら再起動せず error / 'not trusted'
 * - 「Enable Remote Control? (y/n)」が出たら stdin に `y\n` を書く。この起動はダッシュボードで本人（Access で
 *   ログインした人）が「起動」を押した rc_start_dir の結果なので、その意思を端末に反映するだけ。エージェントが
 *   自発的に y を押す経路は無い（起動要求は必ず指示経由。state.json からの復元も元は指示）。書いたことはログに残す
 * - 希望する dir の集合は呼び出し側が state.json に保存し、起動時に restore() で戻す
 * - host の既定 RC（launchd の com.example.claude-rc）はこの仕組みの対象外
 */

export const RC_DIR_RESTART_DELAY_MS = 30 * 1000;
export const RC_DIR_MAX_RESTARTS_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;
const OUTPUT_TAIL_BYTES = 4096;

/** 判定に使う文言（実機で確認済み。docs/verify.md C-1） */
export const RC_DIR_FATAL_PATTERNS = {
  not_trusted: /Workspace not trusted/i,
} as const;

/** 初回起動の同意プロンプト（実機で確認済み。docs/verify.md C-1） */
export const RC_DIR_CONSENT_PROMPT = /Enable Remote Control\?/i;
export const RC_DIR_CONSENT_ANSWER = 'y\n';

export interface ChildLike {
  pid?: number | undefined;
  stdin?: NodeJS.WritableStream | null | undefined;
  stdout?: NodeJS.ReadableStream | null | undefined;
  stderr?: NodeJS.ReadableStream | null | undefined;
  on(event: 'exit', cb: (code: number | null, signal: string | null) => void): unknown;
  on(event: 'error', cb: (e: Error) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}

export type SpawnLike = (cmd: string, args: readonly string[], opts: { cwd: string }) => ChildLike;

export interface Timers {
  set(cb: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface RcDirManagerOptions {
  workDir: string;
  claudePath: string;
  /** --debug-file を置くフォルダ（既定 RC のログと同じ場所） */
  logDir: string;
  log: Logger;
  spawn?: SpawnLike;
  exists?: (path: string) => boolean;
  timers?: Timers;
  now?: () => number;
  /** 起動時の --permission-mode。rc.json を毎回読む（docs/spec.md 13章 #18）。無ければ bypassPermissions */
  permissionMode?: () => string;
}

interface Entry {
  child: ChildLike | null;
  state: RcDirState;
  startedAt?: number;
  detail?: string;
  restarts: number[];
  timer: unknown;
  tail: string;
  /** 起動を要求した指示の id（復元なら 'state.json'）。同意プロンプトへの入力のログに使う */
  source: string;
  /** 同意プロンプトに答えたか（1 プロセスにつき 1 回だけ） */
  consented: boolean;
}

export const realSpawn: SpawnLike = (cmd, args, opts) =>
  spawn(cmd, [...args], { cwd: opts.cwd, stdio: ['pipe', 'pipe', 'pipe'] }) as ChildProcess;

const realTimers: Timers = {
  set: (cb, ms) => setTimeout(cb, ms),
  clear: (h) => clearTimeout(h as NodeJS.Timeout),
};

export class RcDirManager {
  private readonly desiredSet = new Set<string>();
  private readonly entries = new Map<string, Entry>();
  private readonly spawnImpl: SpawnLike;
  private readonly exists: (path: string) => boolean;
  private readonly timers: Timers;
  private readonly now: () => number;
  private stopping = false;

  constructor(private readonly opts: RcDirManagerOptions) {
    this.spawnImpl = opts.spawn ?? realSpawn;
    this.exists = opts.exists ?? existsSync;
    this.timers = opts.timers ?? realTimers;
    this.now = opts.now ?? Date.now;
  }

  /** state.json に保存する集合 */
  desired(): string[] {
    return [...this.desiredSet].sort();
  }

  /** 起動時に state.json から戻す */
  restore(dirs: readonly string[]): void {
    for (const d of dirs) {
      const r = this.start(d, 'state.json');
      if (!r.ok) this.opts.log.warn('追加 RC を復元できない', { dir: d, reason: r.reason });
    }
  }

  /** 追加して起動。既に動いていれば already。source は起動を要求した指示の id */
  start(
    dir: string,
    source: string,
  ): { ok: true; already: boolean } | { ok: false; reason: string } {
    const cwd = this.resolveDir(dir);
    if (cwd === null) return { ok: false, reason: 'invalid dir' };
    if (!this.exists(cwd)) return { ok: false, reason: 'missing' };
    const existing = this.entries.get(dir);
    if (existing && existing.child !== null) {
      this.desiredSet.add(dir);
      return { ok: true, already: true };
    }
    this.desiredSet.add(dir);
    if (existing) {
      this.timers.clear(existing.timer);
      existing.timer = null;
      existing.restarts = [];
    }
    this.spawnOne(dir, cwd, source);
    return { ok: true, already: false };
  }

  /** 止めて集合から外す */
  stop(dir: string): { ok: true; wasRunning: boolean } | { ok: false; reason: string } {
    if (!isRcDirName(dir)) return { ok: false, reason: 'invalid dir' };
    this.desiredSet.delete(dir);
    const e = this.entries.get(dir);
    if (!e) return { ok: true, wasRunning: false };
    this.timers.clear(e.timer);
    const wasRunning = e.child !== null;
    if (e.child) e.child.kill('SIGTERM');
    this.entries.delete(dir);
    return { ok: true, wasRunning };
  }

  /** SIGTERM：子をすべて止める。再起動はしない */
  shutdown(): void {
    this.stopping = true;
    for (const e of this.entries.values()) {
      this.timers.clear(e.timer);
      if (e.child) e.child.kill('SIGTERM');
    }
  }

  logPathFor(dir: string): string {
    return join(this.opts.logDir, `claude-rc-${dir}.log`);
  }

  /** 動いている（または希望している）dir のログの場所。sessions の収集に使う */
  logPaths(): string[] {
    return [...this.entries.keys()].map((d) => this.logPathFor(d));
  }

  /**
   * ハートビートに載せる形。isConnected(dir) が true なら starting → running に上げる
   * （接続の判定はログで行うので、呼び出し側が classifyRcLog を渡す）
   */
  snapshot(isConnected: (dir: string) => boolean = () => false): RcDirRunning[] {
    const out: RcDirRunning[] = [];
    for (const [dir, e] of [...this.entries].sort(([a], [b]) => a.localeCompare(b))) {
      // 一度つながったら running に固定する（ログの末尾から接続の行が流れても戻さない。次の spawn で starting に戻る）
      if (e.state === 'starting' && e.child !== null && isConnected(dir)) e.state = 'running';
      const state: RcDirState = e.state;
      const r: RcDirRunning = { dir, state, name: dir };
      if (e.startedAt !== undefined) r.started_at = e.startedAt;
      if (e.detail) r.detail = e.detail;
      out.push(r);
    }
    return out;
  }

  // ---------- 内部 ----------

  /** dir を検証して cwd を返す。work_dir 配下でなければ null */
  resolveDir(dir: string): string | null {
    if (!isRcDirName(dir)) return null;
    const root = resolve(this.opts.workDir);
    const cwd = resolve(root, dir);
    if (dirname(cwd) !== root || !cwd.startsWith(root + sep)) return null;
    return cwd;
  }

  private spawnOne(dir: string, cwd: string, source?: string): void {
    const entry: Entry = this.entries.get(dir) ?? {
      child: null,
      state: 'starting',
      restarts: [],
      timer: null,
      tail: '',
      source: source ?? 'unknown',
      consented: false,
    };
    if (source !== undefined) entry.source = source;
    entry.tail = '';
    entry.consented = false;
    entry.state = 'starting';
    delete entry.detail;
    this.entries.set(dir, entry);

    let child: ChildLike;
    try {
      child = this.spawnImpl(
        this.opts.claudePath,
        [
          'remote-control',
          '--name',
          dir,
          '--permission-mode',
          this.opts.permissionMode?.() ?? 'bypassPermissions',
          '--debug-file',
          this.logPathFor(dir),
        ],
        { cwd },
      );
    } catch {
      this.onExit(dir, entry, null, 'spawn failed');
      return;
    }
    entry.child = child;
    entry.startedAt = this.now();
    this.opts.log.info('追加 RC を起動', { dir, pid: child.pid ?? null });

    const collect = (chunk: unknown): void => {
      entry.tail = (entry.tail + String(chunk)).slice(-OUTPUT_TAIL_BYTES);
      if (!entry.consented && RC_DIR_CONSENT_PROMPT.test(entry.tail)) {
        entry.consented = true;
        this.answerConsent(dir, entry, child);
      }
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    let done = false;
    child.on('exit', (code) => {
      if (done) return;
      done = true;
      this.onExit(dir, entry, code, null);
    });
    child.on('error', (e) => {
      if (done) return;
      done = true;
      this.onExit(dir, entry, null, (e as NodeJS.ErrnoException).code ?? 'spawn error');
    });
  }

  private onExit(dir: string, entry: Entry, code: number | null, reason: string | null): void {
    entry.child = null;
    const current = this.entries.get(dir);
    if (current !== entry) return; // stop() で外されたあとの遅れた exit
    if (!this.desiredSet.has(dir) || this.stopping) {
      entry.state = 'stopped';
      return;
    }
    const verdict = classifyRcDirExit(entry.tail, code, reason);
    if (verdict.fatal) {
      entry.state = 'error';
      entry.detail = verdict.detail;
      this.opts.log.error('追加 RC が起動できない', { dir, detail: verdict.detail });
      return;
    }
    const now = this.now();
    entry.restarts = entry.restarts.filter((t) => now - t < HOUR_MS);
    if (entry.restarts.length >= RC_DIR_MAX_RESTARTS_PER_HOUR) {
      entry.state = 'error';
      entry.detail = 'restart limit';
      this.opts.log.error('追加 RC の再起動が上限に達した（1 時間に 5 回）', { dir });
      return;
    }
    entry.state = 'stopped';
    entry.detail = verdict.detail;
    entry.restarts.push(now);
    this.opts.log.warn('追加 RC が終了。30 秒後に再起動', { dir, detail: verdict.detail });
    const cwd = this.resolveDir(dir);
    entry.timer = this.timers.set(() => {
      entry.timer = null;
      if (!this.desiredSet.has(dir) || this.stopping || cwd === null) return;
      this.spawnOne(dir, cwd);
    }, RC_DIR_RESTART_DELAY_MS);
  }

  /** 同意プロンプトに y を入力する（本人の「起動」操作の反映。ログに 1 行残す） */
  private answerConsent(dir: string, entry: Entry, child: ChildLike): void {
    if (!child.stdin) {
      this.opts.log.warn('同意プロンプトが出たが stdin に書けない', { dir });
      return;
    }
    try {
      child.stdin.write(RC_DIR_CONSENT_ANSWER);
      this.opts.log.info(`同意プロンプトに y を入力（指示 ${entry.source} による）`, { dir });
    } catch {
      this.opts.log.warn('同意プロンプトへの入力に失敗', { dir });
    }
  }
}

/** 終了時の出力（末尾）と終了コードから、再起動してよいかを決める（純粋関数） */
export function classifyRcDirExit(
  outputTail: string,
  code: number | null,
  reason: string | null,
): { fatal: boolean; detail: string } {
  if (RC_DIR_FATAL_PATTERNS.not_trusted.test(outputTail))
    return { fatal: true, detail: 'not trusted' };
  if (reason) return { fatal: false, detail: reason };
  return { fatal: false, detail: code === null ? 'killed' : `exit ${code}` };
}
