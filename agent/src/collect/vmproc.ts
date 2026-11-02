import type { Runner } from '../exec.js';
import { findVmProcesses, vmNameFromLsof, type PsRow } from './usage.js';

/**
 * pid → VM 名の対応を lsof で作り、キャッシュする（docs/verify.md B-4）。
 * lsof は数秒かかるので、新しい pid が現れたときだけ取り直し、消えた pid は捨てる。
 * 対応付けできなかった pid は null で覚えておき、毎回 lsof を打たない。
 */
export class VmProcessResolver {
  private readonly cache = new Map<number, string | null>();

  constructor(private readonly lsofPath = '/usr/sbin/lsof') {}

  async resolve(run: Runner, rows: readonly PsRow[]): Promise<Map<number, string | null>> {
    const current = findVmProcesses(rows);
    const alive = new Set(current.map((r) => r.pid));
    for (const pid of [...this.cache.keys()]) if (!alive.has(pid)) this.cache.delete(pid);
    for (const r of current) {
      if (this.cache.has(r.pid)) continue;
      const res = await run(this.lsofPath, ['-p', String(r.pid), '-Fn'], { timeoutMs: 30_000 });
      // lsof は一部のファイルが読めないと非 0 を返すことがあるが、出力があれば使う
      this.cache.set(r.pid, res.stdout ? (vmNameFromLsof(res.stdout) ?? null) : null);
    }
    return new Map(this.cache);
  }

  /** 対応付けできなかった pid を次回に再試行させたいときに使う */
  forget(pid: number): void {
    this.cache.delete(pid);
  }
}
