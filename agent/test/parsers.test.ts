import { describe, expect, it } from 'vitest';
import { parseLaunchctlPrint } from '../src/collect/launchctl.js';
import { parseTartGet, parseTartIp, parseTartList, vmStateOf } from '../src/collect/tart.js';
import {
  cpuPctBetween,
  findVmProcesses,
  hostOwnUsage,
  parseBoottime,
  parseClaudeVersion,
  parseDfK,
  parseDuSkGb,
  parsePs,
  parseSwVers,
  parseSysctlNumber,
  parseTartVersion,
  parseVmStatUsedGb,
  processCpuPct,
  sumCpuTimes,
  vmNameFromLsof,
  vmProcessUsage,
} from '../src/collect/usage.js';

describe('launchctl print', () => {
  const running = `gui/501/co.bridgeui.agentstation.claude-rc = {
	active count = 1
	path = /Users/x/Library/LaunchAgents/co.bridgeui.agentstation.claude-rc.plist
	state = running
	program = /Users/x/.local/bin/claude
	pid = 4321
	runs = 3
}`;
  it('running と pid を取る', () => {
    expect(parseLaunchctlPrint({ code: 0, stdout: running, stderr: '' })).toEqual({
      state: 'running',
      pid: 4321,
    });
  });
  it('waiting は stopped', () => {
    const out = running.replace('state = running', 'state = waiting').replace('\tpid = 4321\n', '');
    expect(parseLaunchctlPrint({ code: 0, stdout: out, stderr: '' })).toEqual({ state: 'stopped' });
  });
  it('未登録は stopped、その他の失敗は unknown', () => {
    expect(
      parseLaunchctlPrint({
        code: 113,
        stdout: '',
        stderr: 'Could not find service "x" in domain',
      }),
    ).toEqual({ state: 'stopped' });
    expect(parseLaunchctlPrint({ code: 1, stdout: '', stderr: 'Bad request' })).toEqual({
      state: 'unknown',
    });
  });
});

describe('版・付帯情報', () => {
  it('claude --version', () => {
    expect(parseClaudeVersion('2.1.50 (Claude Code)\n')).toBe('2.1.50');
    expect(parseClaudeVersion('garbage')).toBeUndefined();
  });
  it('sw_vers / tart --version', () => {
    expect(parseSwVers('26.1\n')).toBe('26.1');
    expect(parseTartVersion('2.27.1\n')).toBe('2.27.1');
  });
  it('sysctl', () => {
    expect(parseSysctlNumber('10\n')).toBe(10);
    expect(parseSysctlNumber('25769803776\n')).toBe(25769803776);
    expect(parseBoottime('{ sec = 1761900000, usec = 123456 } Fri Oct 31 09:00:00 2026\n')).toBe(
      1761900000000,
    );
  });
});

describe('ディスク・メモリ', () => {
  it('df -k /', () => {
    const out = `Filesystem    1024-blocks      Used Available Capacity iused      ifree %iused  Mounted on
/dev/disk3s1s1  494384536 220000000 270000000    45%  500000 2700000000    0%   /
`;
    expect(parseDfK(out)).toEqual({ total_gb: 471.5, used_gb: 209.8 });
    expect(parseDfK('')).toBeUndefined();
  });
  it('du -sk', () => {
    expect(parseDuSkGb('43980465\t/Users/x/.tart/vms/vm1\n')).toBe(41.9);
  });
  it('vm_stat', () => {
    const out = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               12345.
Pages active:                            400000.
Pages inactive:                          300000.
Pages speculative:                        10000.
Pages throttled:                              0.
Pages wired down:                        200000.
Pages purgeable:                          20000.
"Translation faults":                 123456789.
Pages occupied by compressor:            100000.
Pages stored in compressor:              250000.
`;
    // (400000 + 200000 + 100000) * 16384 / 2^30 = 10.7
    expect(parseVmStatUsedGb(out)).toBe(10.7);
    expect(parseVmStatUsedGb('no page size')).toBeUndefined();
  });
});

describe('ps と VM のプロセス（docs/verify.md B-4 の実機の形）', () => {
  const VMX =
    '/System/Library/Frameworks/Virtualization.framework/Versions/A/XPCServices/com.apple.Virtualization.VirtualMachine.xpc/Contents/MacOS/com.apple.Virtualization.VirtualMachine';
  // tart run も VM 本体も ppid=1（launchd 直下）。VM 本体のコマンド行に VM 名は無い
  const ps = `    1     0   0.1   12345 /sbin/launchd
10381     1   0.3   45000 /opt/homebrew/bin/tart run --no-graphics vm1
10383     1 122.0 8493465 ${VMX}
10390     1   0.2   44000 /opt/homebrew/bin/tart run --no-graphics vm2
10392     1  35.5 3000000 ${VMX}
10400 10392   1.0   10000 /some/helper
  400     1   3.5  200000 /Users/x/.local/bin/claude remote-control --debug-file /Users/x/Library/Logs/claude-rc.log
`;
  it('行を読む', () => {
    const rows = parsePs(ps);
    expect(rows).toHaveLength(7);
    expect(rows[2]).toEqual({ pid: 10383, ppid: 1, cpu: 122, rss: 8493465, command: VMX });
  });
  it('VM 本体のプロセスを列挙する', () => {
    expect(findVmProcesses(parsePs(ps)).map((r) => r.pid)).toEqual([10383, 10392]);
  });
  it('lsof の出力から VM 名を取る（-Fn と通常形式）', () => {
    expect(
      vmNameFromLsof('p10383\nf0\nn/dev/null\nf5\nn/Users/taro/.tart/vms/vm1/disk.img\n'),
    ).toBe('vm1');
    expect(
      vmNameFromLsof(
        'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\ncom.apple 10392 taro 7u REG 1,17 96636764160 123 /Users/taro/.tart/vms/vm2/disk.img\n',
      ),
    ).toBe('vm2');
    expect(vmNameFromLsof('n/dev/null\n')).toBeUndefined();
  });
  it('pid→VM 名の対応で合算し、CPU は全コア基準。子孫も含める', () => {
    const map = new Map<number, string | null>([
      [10383, 'vm1'],
      [10392, 'vm2'],
    ]);
    expect(vmProcessUsage(parsePs(ps), 'vm1', 12, map)).toEqual({
      cpu_pct_of_host: 10.2,
      mem_gb: 8.1,
      pids: [10383],
    });
    expect(vmProcessUsage(parsePs(ps), 'vm2', 12, map)).toEqual({
      cpu_pct_of_host: 3,
      mem_gb: 2.9,
      pids: [10392, 10400],
    });
    expect(vmProcessUsage(parsePs(ps), 'vm3', 12, map)).toBeUndefined();
    // tart run の子孫をたどる旧方式では 0 になる（ppid=1）ことの確認
    expect(parsePs(ps).filter((r) => r.ppid === 10381)).toEqual([]);
  });
  it('claude プロセスの CPU%', () => {
    expect(processCpuPct(parsePs(ps), 400)).toBe(3.5);
    expect(processCpuPct(parsePs(ps), 999)).toBeNull();
  });
});

describe('CPU 使用率（os.cpus の差分）', () => {
  it('2 回の差分から出す。初回は undefined', () => {
    const a = sumCpuTimes([{ times: { user: 100, nice: 0, sys: 50, idle: 850, irq: 0 } }]);
    const b = sumCpuTimes([{ times: { user: 400, nice: 0, sys: 100, idle: 1500, irq: 0 } }]);
    expect(cpuPctBetween(null, b)).toBeUndefined();
    // 差分 total=1000, idle=650 → 35%
    expect(cpuPctBetween(a, b)).toBe(35);
    expect(cpuPctBetween(b, b)).toBeUndefined();
  });
});

describe('host 本体＝全体−VM', () => {
  it('引き算して負にはしない', () => {
    expect(
      hostOwnUsage({ cpu_pct: 38, mem_used_gb: 14.2, disk_used_gb: 210 }, [
        { cpu_pct_of_host: 20, mem_gb: 5.8, disk_image_gb: 41 },
        { cpu_pct_of_host: 25, mem_gb: 5 },
      ]),
    ).toEqual({ cpu_pct: 0, mem_used_gb: 3.4, disk_used_gb: 169 });
    expect(hostOwnUsage({}, [])).toEqual({});
  });
});

describe('tart', () => {
  it('list（JSON、キーの大小と running/state の両方）', () => {
    const json = JSON.stringify([
      { Source: 'local', Name: 'vm1', Disk: 90, Size: 41, State: 'running' },
      { source: 'local', name: 'vm2', disk: 90, size: 12, running: false },
    ]);
    const m = parseTartList(json);
    expect(m.get('vm1')).toEqual({ name: 'vm1', state: 'running', disk_gb: 90, size_gb: 41 });
    expect(m.get('vm2')?.state).toBe('stopped');
  });
  it('list（表）', () => {
    const table = `Source Name Disk Size State
local  vm1  90   41   running
local  vm2  90   12   stopped
`;
    const m = parseTartList(table);
    expect(m.get('vm1')?.state).toBe('running');
    expect(m.get('vm2')?.state).toBe('stopped');
  });
  it('ip', () => {
    expect(parseTartIp({ code: 0, stdout: '192.168.64.10\n' })).toBe('192.168.64.10');
    expect(parseTartIp({ code: 1, stdout: '' })).toBeUndefined();
    expect(parseTartIp({ code: 0, stdout: '' })).toBeUndefined();
  });
  it('get（Memory は MB）', () => {
    expect(
      parseTartGet('{"CPU":4,"Memory":6144,"Disk":90,"Display":"1024x768","State":"running"}'),
    ).toEqual({ cpu: 4, mem_gb: 6, disk_gb: 90 });
    expect(parseTartGet('not json')).toEqual({});
  });
  it('4 値の状態', () => {
    expect(vmStateOf('stopped', undefined)).toBe('stopped');
    expect(vmStateOf('running', undefined)).toBe('starting');
    expect(vmStateOf('running', '192.168.64.10')).toBe('running');
    expect(vmStateOf(undefined, undefined)).toBe('unknown');
    expect(vmStateOf('unknown', undefined)).toBe('unknown');
  });
});
