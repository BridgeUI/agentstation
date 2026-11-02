import type { ExecResult } from '../exec.js';

/**
 * 使用量・付帯情報の出力パーサー。すべて文字列を受け取る純粋関数。
 * 実行（Runner 呼び出し）は host.ts / guest.ts 側で行う。
 */

const GB = 1024 * 1024 * 1024;

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** `sysctl -n hw.ncpu` / `hw.memsize` のような 1 行の数値 */
export function parseSysctlNumber(text: string): number | undefined {
  const m = /-?\d+/.exec(text.trim());
  if (!m) return undefined;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : undefined;
}

/** `sysctl -n kern.boottime` → `{ sec = 1761900000, usec = 123 } Fri Oct 31 ...` */
export function parseBoottime(text: string): number | undefined {
  const m = /sec\s*=\s*(\d+)/.exec(text);
  return m ? Number(m[1]) * 1000 : undefined;
}

/** `sw_vers -productVersion` → `26.1` */
export function parseSwVers(text: string): string | undefined {
  const m = /\d+(?:\.\d+)*/.exec(text);
  return m?.[0];
}

/** `tart --version` → `2.27.1` など */
export function parseTartVersion(text: string): string | undefined {
  const m = /\d+\.\d+(?:\.\d+)?/.exec(text);
  return m?.[0];
}

/** `claude --version` → `2.1.50 (Claude Code)` など */
export function parseClaudeVersion(text: string): string | undefined {
  const m = /\d+\.\d+\.\d+(?:[-+][\w.]+)?/.exec(text);
  return m?.[0];
}

export interface DiskUsage {
  total_gb: number;
  used_gb: number;
}

/**
 * `df -k /` の 2 行目:
 * Filesystem 1024-blocks Used Available Capacity iused ifree %iused Mounted on
 */
export function parseDfK(text: string): DiskUsage | undefined {
  const lines = text.trim().split(/\r?\n/);
  const row = lines.find((l, i) => i > 0 && /^\S+\s+\d+\s+\d+\s+\d+/.test(l));
  if (!row) return undefined;
  const cols = row.trim().split(/\s+/);
  const blocks = Number(cols[1]);
  const used = Number(cols[2]);
  if (!Number.isFinite(blocks) || !Number.isFinite(used)) return undefined;
  return { total_gb: round1((blocks * 1024) / GB), used_gb: round1((used * 1024) / GB) };
}

/** `du -sk <dir>` → `12345678\t<dir>`。値は GB */
export function parseDuSkGb(text: string): number | undefined {
  const m = /^\s*(\d+)\s/.exec(text);
  if (!m) return undefined;
  return round1((Number(m[1]) * 1024) / GB);
}

/**
 * `vm_stat` の出力。使用中メモリ ＝ (active + wired + compressor) × page size
 * （アクティビティモニタの「使用済みメモリ」に近い値）。
 */
export function parseVmStatUsedGb(text: string): number | undefined {
  const pageSize = Number(/page size of (\d+) bytes/.exec(text)?.[1] ?? 0);
  if (!pageSize) return undefined;
  const pages = new Map<string, number>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Za-z][A-Za-z -]*?):\s+(\d+)\.?\s*$/.exec(line);
    if (m && m[1] !== undefined && m[2] !== undefined) pages.set(m[1].trim(), Number(m[2]));
  }
  const active = pages.get('Pages active');
  const wired = pages.get('Pages wired down');
  const compressed = pages.get('Pages occupied by compressor') ?? 0;
  if (active === undefined || wired === undefined) return undefined;
  return round1(((active + wired + compressed) * pageSize) / GB);
}

export interface PsRow {
  pid: number;
  ppid: number;
  cpu: number;
  /** KB */
  rss: number;
  command: string;
}

/** `ps -axo pid=,ppid=,%cpu=,rss=,command=`（ヘッダー無し） */
export function parsePs(text: string): PsRow[] {
  const rows: PsRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    rows.push({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      cpu: Number(m[3]),
      rss: Number(m[4]),
      command: m[5] ?? '',
    });
  }
  return rows;
}

export interface ProcessUsage {
  /** 全コアを 100% とした CPU% */
  cpu_pct_of_host: number;
  mem_gb: number;
  pids: number[];
}

/**
 * VM 本体のプロセス（docs/verify.md B-4 で実機確認済み）。
 * `tart run --no-graphics vm1`（ppid 1）とは別に、VM 本体は
 * `/System/Library/Frameworks/Virtualization.framework/.../com.apple.Virtualization.VirtualMachine`
 * として **launchd 直下（ppid 1）** に付け替えられ、コマンド行に VM 名は入らない。
 * tart の子孫をたどる方法では 0 になるので、このプロセスを列挙し、pid ごとに
 * `lsof -p <pid> -Fn` で開いている `/.tart/vms/<name>/disk.img` から VM 名を割り出す（vmproc.ts）。
 * `tart run` 自体の CPU/RSS は小さいので無視する。
 */
export const VM_PROCESS_MARKER = 'com.apple.Virtualization.VirtualMachine';

export function findVmProcesses(rows: readonly PsRow[]): PsRow[] {
  return rows.filter((r) => {
    const exe = r.command.trim().split(/\s+/)[0] ?? '';
    return exe === VM_PROCESS_MARKER || exe.endsWith('/' + VM_PROCESS_MARKER);
  });
}

/** `lsof -p <pid> -Fn`（`n<path>` の行）または通常の `lsof -p` 出力から VM 名を取る */
export function vmNameFromLsof(text: string): string | undefined {
  const m = /\/\.tart\/vms\/([^/\s]+)\/disk\.img\b/.exec(text);
  return m?.[1];
}

/**
 * VM ごとの使用量。pidToVm は pid → VM 名（VmProcessResolver が lsof で作る）。
 * 対応付いたプロセスとその子孫を合算し、CPU は全コアを 100% とした値にする。
 */
export function vmProcessUsage(
  rows: readonly PsRow[],
  vmName: string,
  cpuCores: number,
  pidToVm: ReadonlyMap<number, string | null>,
): ProcessUsage | undefined {
  const pids = new Set<number>();
  for (const [pid, name] of pidToVm) if (name === vmName) pids.add(pid);
  if (pids.size === 0) return undefined;
  let grew = true;
  while (grew) {
    grew = false;
    for (const r of rows) {
      if (!pids.has(r.pid) && pids.has(r.ppid)) {
        pids.add(r.pid);
        grew = true;
      }
    }
  }
  let cpu = 0;
  let rssKb = 0;
  for (const r of rows) {
    if (pids.has(r.pid)) {
      cpu += r.cpu;
      rssKb += r.rss;
    }
  }
  const cores = cpuCores > 0 ? cpuCores : 1;
  return {
    cpu_pct_of_host: round1(cpu / cores),
    mem_gb: round1((rssKb * 1024) / GB),
    pids: [...pids].sort((a, b) => a - b),
  };
}

/** claude プロセス（pid）の CPU%。子プロセスは含めない */
export function processCpuPct(rows: PsRow[], pid: number): number | null {
  const r = rows.find((x) => x.pid === pid);
  return r ? r.cpu : null;
}

// ---------- CPU 使用率（os.cpus() の差分） ----------

export interface CpuTimes {
  idle: number;
  total: number;
}

export function sumCpuTimes(cpus: ReadonlyArray<{ times: Record<string, number> }>): CpuTimes {
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    for (const [k, v] of Object.entries(c.times)) {
      total += v;
      if (k === 'idle') idle += v;
    }
  }
  return { idle, total };
}

/** 2 回の採取の差分から全体の CPU% を出す。差分が無ければ undefined */
export function cpuPctBetween(prev: CpuTimes | null, cur: CpuTimes): number | undefined {
  if (!prev) return undefined;
  const dTotal = cur.total - prev.total;
  const dIdle = cur.idle - prev.idle;
  if (dTotal <= 0) return undefined;
  return round1(Math.max(0, Math.min(100, ((dTotal - dIdle) / dTotal) * 100)));
}

// ---------- host 本体の値 ----------

export interface HostWholeUsage {
  cpu_pct?: number;
  mem_used_gb?: number;
  disk_used_gb?: number;
}

export interface VmUsageLike {
  cpu_pct_of_host?: number;
  mem_gb?: number;
  disk_image_gb?: number;
}

/**
 * host 本体の値＝全体−VM 2台分（docs/spec.md 3.6）。
 * ハートビートの host.* には「ホスト全体」を載せる（しきい値判定が全体に対してなので）。
 * 本体だけの値が要るときはこの関数で引く。
 */
export function hostOwnUsage(whole: HostWholeUsage, vms: readonly VmUsageLike[]): HostWholeUsage {
  const out: HostWholeUsage = {};
  if (whole.cpu_pct !== undefined) {
    out.cpu_pct = round1(Math.max(0, whole.cpu_pct - sum(vms, (v) => v.cpu_pct_of_host)));
  }
  if (whole.mem_used_gb !== undefined) {
    out.mem_used_gb = round1(Math.max(0, whole.mem_used_gb - sum(vms, (v) => v.mem_gb)));
  }
  if (whole.disk_used_gb !== undefined) {
    out.disk_used_gb = round1(Math.max(0, whole.disk_used_gb - sum(vms, (v) => v.disk_image_gb)));
  }
  return out;
}

function sum<T>(xs: readonly T[], f: (x: T) => number | undefined): number {
  let s = 0;
  for (const x of xs) s += f(x) ?? 0;
  return s;
}

export function stdoutOf(r: ExecResult): string | undefined {
  return r.code === 0 ? r.stdout : undefined;
}
