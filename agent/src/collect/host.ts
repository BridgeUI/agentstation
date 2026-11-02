import { cpus } from 'node:os';
import type { HostHeartbeat, VmView } from '@agentstation/shared';
import type { AgentConfig } from '../config.js';
import { runDf, type ExecResult, type Runner } from '../exec.js';
import { tartGet, tartIp, tartList, vmStateOf } from './tart.js';
import { VmProcessResolver } from './vmproc.js';
import {
  cpuPctBetween,
  parseBoottime,
  parseDfK,
  parseDuSkGb,
  parsePs,
  parseSwVers,
  parseSysctlNumber,
  parseTartVersion,
  parseVmStatUsedGb,
  round1,
  sumCpuTimes,
  vmProcessUsage,
  type CpuTimes,
  type PsRow,
} from './usage.js';

/** host のエージェントだけが集める：ホスト全体の使用量・付帯情報・VM の状態（docs/spec.md 3.6） */
export interface HostCollected {
  host: HostHeartbeat['host'];
  vms: VmView[];
  /** 作業中判定などで使い回す ps の結果 */
  ps: PsRow[];
}

/** 2 回の採取の差分で CPU% を出すため、前回の値を持つ */
export class CpuSampler {
  private prev: CpuTimes | null = null;
  sample(): number | undefined {
    const cur = sumCpuTimes(cpus());
    const pct = cpuPctBetween(this.prev, cur);
    this.prev = cur;
    return pct;
  }
}

export async function collectHost(
  run: Runner,
  cfg: AgentConfig,
  sampler: CpuSampler,
  resolver: VmProcessResolver,
): Promise<HostCollected> {
  // VM を使わない導入（設定 vms が []）では tart を呼ばない
  const tart = cfg.vms.length > 0 ? cfg.tartPath : null;
  if (cfg.vms.length > 0 && tart === null) throw new Error('VM を使う host には tart_path が必要');
  const skipped: ExecResult = { code: null, stdout: '', stderr: '', timedOut: false };

  const [sw, boot, ncpu, memsize, df, vmstat, ps, tartVer, list] = await Promise.all([
    run('/usr/bin/sw_vers', ['-productVersion']),
    run('/usr/sbin/sysctl', ['-n', 'kern.boottime']),
    run('/usr/sbin/sysctl', ['-n', 'hw.ncpu']),
    run('/usr/sbin/sysctl', ['-n', 'hw.memsize']),
    runDf(run),
    run('/usr/bin/vm_stat', []),
    run('/bin/ps', ['-axo', 'pid=,ppid=,%cpu=,rss=,command=']),
    tart ? run(tart, ['--version']) : Promise.resolve(skipped),
    tart ? tartList(run, tart) : Promise.resolve(null),
  ]);

  const host: HostHeartbeat['host'] = {};
  const os = sw.code === 0 ? parseSwVers(sw.stdout) : undefined;
  if (os !== undefined) host.os_version = os;
  const tv = tartVer.code === 0 ? parseTartVersion(tartVer.stdout) : undefined;
  if (tv !== undefined) host.tart_version = tv;
  const bootAt = boot.code === 0 ? parseBoottime(boot.stdout) : undefined;
  if (bootAt !== undefined) host.boot_at = bootAt;
  const cores = ncpu.code === 0 ? parseSysctlNumber(ncpu.stdout) : undefined;
  if (cores !== undefined) host.cpu_cores = cores;
  const memBytes = memsize.code === 0 ? parseSysctlNumber(memsize.stdout) : undefined;
  if (memBytes !== undefined) host.mem_total_gb = round1(memBytes / 1024 / 1024 / 1024);
  const disk = df.code === 0 ? parseDfK(df.stdout) : undefined;
  if (disk) {
    host.disk_total_gb = disk.total_gb;
    host.disk_used_gb = disk.used_gb;
  }
  const memUsed = vmstat.code === 0 ? parseVmStatUsedGb(vmstat.stdout) : undefined;
  if (memUsed !== undefined) host.mem_used_gb = memUsed;
  const cpuPct = sampler.sample();
  if (cpuPct !== undefined) host.cpu_pct = cpuPct;

  const psRows = ps.code === 0 ? parsePs(ps.stdout) : [];
  const pidToVm = await resolver.resolve(run, psRows);

  const vms: VmView[] = [];
  for (const vm of cfg.vms) {
    if (tart === null) break;
    const name = cfg.vmNames[vm];
    const entry = list?.get(name);
    const listState = list === null ? undefined : (entry?.state ?? 'unknown');
    // 固定 IP が設定にあればそれを使う（IP 変更直後は ARP に旧 IP が残り tart ip が古い値を返すことがある）
    const ip =
      listState === 'running' ? (cfg.vmIps[vm] ?? (await tartIp(run, tart, name))) : undefined;
    const view: VmView = { env: vm, vm_state: vmStateOf(listState, ip), usage: {}, alloc: {} };
    if (ip !== undefined) view.ip = ip;

    const proc = vmProcessUsage(psRows, name, cores ?? 1, pidToVm);
    if (proc) {
      view.usage.cpu_pct_of_host = proc.cpu_pct_of_host;
      view.usage.mem_gb = proc.mem_gb;
    }
    const du = await run('/usr/bin/du', ['-sk', `${cfg.tartVmsDir}/${name}`], {
      timeoutMs: 60_000,
    });
    const imageGb = du.code === 0 ? parseDuSkGb(du.stdout) : entry?.size_gb;
    if (imageGb !== undefined) view.usage.disk_image_gb = imageGb;

    const alloc = await tartGet(run, tart, name);
    if (alloc.cpu !== undefined) view.alloc.cpu = alloc.cpu;
    if (alloc.mem_gb !== undefined) view.alloc.mem_gb = alloc.mem_gb;
    const diskAlloc = alloc.disk_gb ?? entry?.disk_gb;
    if (diskAlloc !== undefined) view.alloc.disk_gb = diskAlloc;
    vms.push(view);
  }

  return { host, vms, ps: psRows };
}
