import type { VmState } from '@agentstation/shared';
import type { ExecResult, Runner } from '../exec.js';

/**
 * Tart の出力パーサー（host だけが使う）。
 * `tart list --format json` / `tart get <vm> --format json` の JSON キーは版で違い得るので、
 * 大文字小文字と `running`（真偽値）/ `state`（文字列）の両方を受ける。
 * 未確認: 手元の tart の JSON の形（docs/verify.md B-1 の `tart list` で確かめる）。
 */

export interface TartListEntry {
  name: string;
  state: 'stopped' | 'running' | 'unknown';
  /** 割り当て（GB）。取れなければ undefined */
  disk_gb?: number;
  /** 実使用（GB） */
  size_gb?: number;
}

export function parseTartList(text: string): Map<string, TartListEntry> {
  const out = new Map<string, TartListEntry>();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return parseTartListTable(text);
  }
  if (!Array.isArray(raw)) return out;
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const o = lowerKeys(item as Record<string, unknown>);
    const name = o.name;
    if (typeof name !== 'string') continue;
    const e: TartListEntry = { name, state: stateOf(o) };
    const disk = numberOf(o.disk);
    const size = numberOf(o.size);
    if (disk !== undefined) e.disk_gb = disk;
    if (size !== undefined) e.size_gb = size;
    out.set(name, e);
  }
  return out;
}

/** JSON が使えない版向け。`Source Name Disk Size State` の表 */
function parseTartListTable(text: string): Map<string, TartListEntry> {
  const out = new Map<string, TartListEntry>();
  const lines = text.trim().split(/\r?\n/);
  const header =
    lines[0]
      ?.trim()
      .split(/\s+/)
      .map((h) => h.toLowerCase()) ?? [];
  const iName = header.indexOf('name');
  const iState = header.indexOf('state');
  if (iName < 0 || iState < 0) return out;
  for (const line of lines.slice(1)) {
    const cols = line.trim().split(/\s+/);
    const name = cols[iName];
    const st = cols[iState];
    if (!name) continue;
    out.set(name, {
      name,
      state: st === 'running' ? 'running' : st === 'stopped' ? 'stopped' : 'unknown',
    });
  }
  return out;
}

function stateOf(o: Record<string, unknown>): TartListEntry['state'] {
  if (typeof o.state === 'string') {
    const s = o.state.toLowerCase();
    return s === 'running' ? 'running' : s === 'stopped' ? 'stopped' : 'unknown';
  }
  if (typeof o.running === 'boolean') return o.running ? 'running' : 'stopped';
  return 'unknown';
}

function lowerKeys(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) out[k.toLowerCase()] = v;
  return out;
}

function numberOf(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v)) return Number(v);
  return undefined;
}

/** `tart ip <vm>` → IPv4 1 行。取れないときは非 0 終了か空 */
export function parseTartIp(r: Pick<ExecResult, 'code' | 'stdout'>): string | undefined {
  if (r.code !== 0) return undefined;
  const m = /\b(\d{1,3}(?:\.\d{1,3}){3})\b/.exec(r.stdout);
  return m?.[1];
}

export interface TartAlloc {
  cpu?: number;
  mem_gb?: number;
  disk_gb?: number;
}

/** `tart get <vm> --format json` → {"CPU":4,"Memory":6144,"Disk":90,...}（Memory は MB） */
export function parseTartGet(text: string): TartAlloc {
  const out: TartAlloc = {};
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return out;
  }
  if (typeof raw !== 'object' || raw === null) return out;
  const o = lowerKeys(raw as Record<string, unknown>);
  const cpu = numberOf(o.cpu);
  const mem = numberOf(o.memory);
  const disk = numberOf(o.disk);
  if (cpu !== undefined) out.cpu = cpu;
  if (mem !== undefined) out.mem_gb = Math.round((mem / 1024) * 10) / 10;
  if (disk !== undefined) out.disk_gb = disk;
  return out;
}

/** docs/spec.md 3.5 の 4 値。running でも IP が取れない間は starting */
export function vmStateOf(
  listState: TartListEntry['state'] | undefined,
  ip: string | undefined,
): VmState {
  if (listState === undefined || listState === 'unknown') return 'unknown';
  if (listState === 'stopped') return 'stopped';
  return ip ? 'running' : 'starting';
}

export async function tartList(
  run: Runner,
  tart: string,
): Promise<Map<string, TartListEntry> | null> {
  const r = await run(tart, ['list', '--format', 'json'], { timeoutMs: 30_000 });
  if (r.code !== 0) return null;
  return parseTartList(r.stdout);
}

/** VM の IP。既定（DHCP リース）で引けなければ ARP で引く（ゲスト内で静的 IP にすると DHCP リースに載らない。実機 vm1 で確認） */
export async function tartIp(run: Runner, tart: string, vm: string): Promise<string | undefined> {
  const r = await run(tart, ['ip', vm], { timeoutMs: 20_000 });
  const ip = parseTartIp(r);
  if (ip) return ip;
  const arp = await run(tart, ['ip', vm, '--resolver', 'arp'], { timeoutMs: 20_000 });
  return parseTartIp(arp);
}

export async function tartGet(run: Runner, tart: string, vm: string): Promise<TartAlloc> {
  const r = await run(tart, ['get', vm, '--format', 'json'], { timeoutMs: 20_000 });
  return r.code === 0 ? parseTartGet(r.stdout) : {};
}
