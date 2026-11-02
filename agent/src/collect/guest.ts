import type { VmHeartbeat } from '@agentstation/shared';
import { runDf, type Runner } from '../exec.js';
import { parseBoottime, parseDfK, parseSwVers } from './usage.js';

/** vm1 / vm2 のゲスト情報（docs/spec.md 3.6）。CPU・メモリは host 側の値を使うので送らない */
export async function collectGuest(run: Runner): Promise<VmHeartbeat['guest']> {
  const [sw, boot, df] = await Promise.all([
    run('/usr/bin/sw_vers', ['-productVersion']),
    run('/usr/sbin/sysctl', ['-n', 'kern.boottime']),
    runDf(run),
  ]);
  const guest: VmHeartbeat['guest'] = {};
  const os = sw.code === 0 ? parseSwVers(sw.stdout) : undefined;
  const bootAt = boot.code === 0 ? parseBoottime(boot.stdout) : undefined;
  const disk = df.code === 0 ? parseDfK(df.stdout) : undefined;
  if (os !== undefined) guest.os_version = os;
  if (bootAt !== undefined) guest.boot_at = bootAt;
  if (disk) {
    guest.disk_used_gb = disk.used_gb;
    guest.disk_total_gb = disk.total_gb;
  }
  return guest;
}
