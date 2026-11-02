import { describe, expect, it } from 'vitest';
import { parsePs } from '../src/collect/usage.js';
import { VmProcessResolver } from '../src/collect/vmproc.js';
import type { ExecResult, Runner } from '../src/exec.js';

const VMX =
  '/System/Library/Frameworks/Virtualization.framework/Versions/A/XPCServices/com.apple.Virtualization.VirtualMachine.xpc/Contents/MacOS/com.apple.Virtualization.VirtualMachine';
const ps = (pids: number[]) =>
  parsePs(
    ['10381     1   0.3   45000 /opt/homebrew/bin/tart run --no-graphics vm1']
      .concat(pids.map((p) => `${p}     1  50.0 1000000 ${VMX}`))
      .join('\n'),
  );

describe('VmProcessResolver（lsof は pid が変わったときだけ）', () => {
  it('pid ごとに lsof -p <pid> -Fn を 1 回だけ打ち、消えた pid は捨てる', async () => {
    const calls: string[][] = [];
    const names: Record<string, string> = { '10383': 'vm1', '10392': 'vm2' };
    const run: Runner = async (cmd, args) => {
      calls.push([cmd, ...args]);
      const pid = args[1] ?? '';
      const name = names[pid];
      const r: ExecResult = {
        code: 0,
        stdout: name ? `p${pid}\nf5\nn/Users/taro/.tart/vms/${name}/disk.img\n` : 'n/dev/null\n',
        stderr: '',
        timedOut: false,
      };
      return r;
    };
    const resolver = new VmProcessResolver();
    const a = await resolver.resolve(run, ps([10383, 10392]));
    expect([...a]).toEqual([
      [10383, 'vm1'],
      [10392, 'vm2'],
    ]);
    expect(calls).toEqual([
      ['/usr/sbin/lsof', '-p', '10383', '-Fn'],
      ['/usr/sbin/lsof', '-p', '10392', '-Fn'],
    ]);

    // 同じ pid なら lsof を打たない
    await resolver.resolve(run, ps([10383, 10392]));
    expect(calls).toHaveLength(2);

    // vm2 が再起動して pid が変わった → その pid だけ取り直し、古い pid は消える
    names['20000'] = 'vm2';
    const c = await resolver.resolve(run, ps([10383, 20000]));
    expect([...c]).toEqual([
      [10383, 'vm1'],
      [20000, 'vm2'],
    ]);
    expect(calls).toHaveLength(3);
    expect(calls[2]).toEqual(['/usr/sbin/lsof', '-p', '20000', '-Fn']);

    // 対応付けできない pid は null で覚え、毎回は打たない
    await resolver.resolve(run, ps([10383, 20000, 30000]));
    await resolver.resolve(run, ps([10383, 20000, 30000]));
    expect(calls).toHaveLength(4);
    expect((await resolver.resolve(run, ps([30000]))).get(30000)).toBeNull();
  });
});
