import { describe, expect, it } from 'vitest';
import { setupKeysFor, type SetupCheckKey } from '@agentstation/shared';
import {
  collectSetup,
  judgeAppStoreAuto,
  judgeAutoLogin,
  judgeAutoupdaterOff,
  judgeClaudeAuth,
  judgeDiskFree,
  judgeEthernet,
  judgeFileVault,
  judgeLaunchd,
  judgePgrep,
  judgePmset,
  judgePort,
  judgeSmbWorkspace,
  parseSharePoints,
  judgeSoftwareUpdate,
  judgeSudoers,
  judgeTimezone,
  judgeTmutil,
  judgeUserName,
  judgeWorkdir,
  parseDefaultsDict,
  parseHardwarePorts,
  toCheck,
  type SetupDeps,
} from '../src/collect/setup.js';
import { buildConfig } from '../src/config.js';
import type { ExecResult, Runner } from '../src/exec.js';
import { findForbidden } from '../src/send/filter.js';

const PMSET = `System-wide power settings:
Currently in use:
 standby              1
 Sleep On Power Button 1
 autorestartatconnect 1
 autorestart          0
 hibernatefile        /var/vm/sleepimage
 powernap             0
 disksleep            0
 sleep                0 (sleep prevented by powerd)
 displaysleep         10
`;

describe('電源・セキュリティ・ログイン', () => {
  it('pmset', () => {
    expect(judgePmset(PMSET, 'sleep', '0')).toEqual({ status: 'ok', detail: 'sleep=0' });
    expect(judgePmset(PMSET, 'displaysleep', '0')).toEqual({
      status: 'ng',
      detail: 'displaysleep=10',
    });
    expect(judgePmset(PMSET, 'womp', '1')).toEqual({ status: 'skip', detail: 'not present' });
  });
  it('FileVault', () => {
    expect(judgeFileVault('FileVault is Off.\n').status).toBe('ok');
    expect(judgeFileVault('FileVault is On.\n')).toEqual({ status: 'ng', detail: 'on' });
    expect(judgeFileVault('').status).toBe('unknown');
  });
  it('自動ログイン', () => {
    expect(judgeAutoLogin({ code: 0, stdout: 'taro\n' }, 'taro').status).toBe('ok');
    expect(judgeAutoLogin({ code: 0, stdout: 'bob\n' }, 'taro')).toEqual({
      status: 'ng',
      detail: 'other user',
    });
    expect(judgeAutoLogin({ code: 1, stdout: '' }, 'taro')).toEqual({
      status: 'ng',
      detail: 'not set',
    });
  });
});

describe('自動更新', () => {
  const dict = `{
    AutomaticCheckEnabled = 1;
    AutomaticDownload = 0;
    AutomaticallyInstallMacOSUpdates = 0;
    ConfigDataInstall = 0;
    CriticalUpdateInstall = 0;
    LastAttemptSystemVersion = "27.2";
}`;
  it('defaults の辞書を読む', () => {
    const d = parseDefaultsDict(dict);
    expect(d.get('AutomaticDownload')).toBe('0');
    expect(d.get('LastAttemptSystemVersion')).toBe('27.2');
  });
  it('4 キーがすべて 0 なら ok、無い・1 なら ng', () => {
    expect(judgeSoftwareUpdate({ code: 0, stdout: dict }).status).toBe('ok');
    expect(
      judgeSoftwareUpdate({
        code: 0,
        stdout: dict.replace('ConfigDataInstall = 0', 'ConfigDataInstall = 1'),
      }),
    ).toEqual({
      status: 'ng',
      detail: 'ConfigDataInstall=1',
    });
    expect(
      judgeSoftwareUpdate({ code: 0, stdout: dict.replace('    AutomaticDownload = 0;\n', '') }),
    ).toEqual({
      status: 'ng',
      detail: 'AutomaticDownload=missing',
    });
    expect(judgeSoftwareUpdate({ code: 1, stdout: '' })).toEqual({
      status: 'ng',
      detail: 'not set',
    });
  });
  it('App Store', () => {
    expect(judgeAppStoreAuto({ code: 0, stdout: '0\n' }).status).toBe('ok');
    expect(judgeAppStoreAuto({ code: 0, stdout: '1\n' })).toEqual({
      status: 'ng',
      detail: 'AutoUpdate=1',
    });
    expect(judgeAppStoreAuto({ code: 1, stdout: '' })).toEqual({ status: 'ng', detail: 'not set' });
  });
});

describe('共有・ネットワーク・タイムゾーン', () => {
  const SHARING = `
\t\t\tList of Share Points
name:\t\tTaro のパブリックフォルダ
path:\t\t/Users/taro/Public
\tsmb:\t{
    \t\tname:\tTaro のパブリックフォルダ
    \t\tshared:\t1
    \t\tguest access:\t1
    \t\tread-only:\t0
\t}

name:\t\tworkspace
path:\t\t/Users/taro/workspace
\tsmb:\t{
    \t\tname:\tworkspace
    \t\tshared:\t1
    \t\tguest access:\t0
    \t\tread-only:\t0
\t}
`;
  const HASHES = 'SALTED-SHA512-PBKDF2\nSRP-RFC5054-4096-SHA512-PBKDF2\nSMB-NT\n';
  it('SMB の workspace 共有', () => {
    expect([...parseSharePoints(SHARING).entries()]).toEqual([
      ['Taro のパブリックフォルダ', { guest: true }],
      ['workspace', { guest: false }],
    ]);
    expect(judgeSmbWorkspace(SHARING, HASHES, true)).toEqual({
      status: 'ok',
      detail: 'workspace · port 445 open',
    });
    // ゲスト許可・ハッシュ無し・445 閉じ、は全部 detail に出る（パスは出ない）
    const guestOn = SHARING.replace('guest access:\t0', 'guest access:\t1');
    const v = judgeSmbWorkspace(guestOn, 'SALTED-SHA512-PBKDF2\n', false);
    expect(v.status).toBe('ng');
    expect(v.detail).toBe('ゲスト許可（-g 000 にする）・SMB-NT ハッシュなし・port 445 closed');
    expect(v.detail).not.toContain('/Users');
    expect(judgeSmbWorkspace('List of Share Points\n', HASHES, true).detail).toBe(
      'workspace 共有なし',
    );
    // 共有もハッシュも揃っていて 445 だけ判定できないときは unknown
    expect(judgeSmbWorkspace(SHARING, HASHES, null).status).toBe('unknown');
  });
  it('ポート', () => {
    expect(judgePort(true, 22)).toEqual({ status: 'ok', detail: 'port 22 open' });
    expect(judgePort(false, 5900)).toEqual({ status: 'ng', detail: 'port 5900 closed' });
    expect(judgePort(null, 22).status).toBe('unknown');
  });
  const ports = `Hardware Port: Ethernet
Device: en0
Ethernet Address: 00:11:22:33:44:55

Hardware Port: Wi-Fi
Device: en1
Ethernet Address: 00:11:22:33:44:56

Hardware Port: Thunderbolt Bridge
Device: bridge0
Ethernet Address: N/A
`;
  const route = (iface: string) =>
    `   route to: default\ndestination: default\n       mask: default\n    gateway: 192.168.1.1\n  interface: ${iface}\n      flags: <UP,GATEWAY,DONE,STATIC,PRCLONING,GLOBAL>\n`;
  it('有線 LAN', () => {
    expect(parseHardwarePorts(ports).get('en1')).toBe('Wi-Fi');
    expect(judgeEthernet(route('en0'), ports)).toEqual({ status: 'ok', detail: 'en0: Ethernet' });
    expect(judgeEthernet(route('en1'), ports)).toEqual({ status: 'ng', detail: 'en1: Wi-Fi' });
    expect(judgeEthernet(route('utun3'), ports).status).toBe('unknown');
    expect(judgeEthernet('', ports)).toEqual({ status: 'unknown', detail: 'no default route' });
  });
  it('タイムゾーン', () => {
    expect(judgeTimezone('/var/db/timezone/zoneinfo/Asia/Tokyo\n').status).toBe('ok');
    expect(judgeTimezone('/var/db/timezone/zoneinfo/America/New_York\n')).toEqual({
      status: 'ng',
      detail: 'America/New_York',
    });
    expect(judgeTimezone('').status).toBe('unknown');
  });
});

describe('Claude', () => {
  it('auth status（メールは detail に入れない）', () => {
    const json = '{"loggedIn":true,"authMethod":"claude.ai","email":"someone@example.com"}';
    expect(judgeClaudeAuth({ code: 0, stdout: json })).toEqual({ status: 'ok' });
    expect(judgeClaudeAuth({ code: 0, stdout: json.replace('true', 'false') })).toEqual({
      status: 'ng',
      detail: 'not logged in',
    });
    expect(judgeClaudeAuth({ code: 0, stdout: 'Logged in as x' }).status).toBe('unknown');
    expect(judgeClaudeAuth({ code: 1, stdout: '' })).toEqual({
      status: 'unknown',
      detail: 'exit 1',
    });
  });
  it('自動更新オフ', () => {
    expect(judgeAutoupdaterOff('{"env":{"DISABLE_AUTOUPDATER":"1"}}').status).toBe('ok');
    expect(judgeAutoupdaterOff('{"env":{}}').status).toBe('ng');
    expect(judgeAutoupdaterOff('{}').status).toBe('ng');
    expect(judgeAutoupdaterOff(null)).toEqual({ status: 'ng', detail: 'no settings.json' });
    expect(judgeAutoupdaterOff('{oops').status).toBe('unknown');
  });
  it('作業フォルダ（detail は最後の要素だけ）', () => {
    expect(judgeWorkdir('/Users/t/work/rc', '/Users/t', true)).toEqual({
      status: 'ok',
      detail: 'rc',
    });
    expect(judgeWorkdir('/Users/t/work/rc', '/Users/t', false)).toEqual({
      status: 'ng',
      detail: 'rc: missing',
    });
    expect(judgeWorkdir('/Users/t/workspace', '/Users/t', true)).toEqual({
      status: 'ok',
      detail: 'workspace',
    });
    expect(judgeWorkdir('/Users/t/Downloads/rc', '/Users/t', true).status).toBe('ng');
    expect(judgeWorkdir('/Users/t/Desktop/x/rc', '/Users/t', true)).toEqual({
      status: 'ng',
      detail: 'rc: under Desktop',
    });
    expect(judgeWorkdir('/Users/t/Documents', '/Users/t', true).status).toBe('ng');
    expect(judgeWorkdir('/Users/t', '/Users/t', true)).toEqual({ status: 'ng', detail: 'is home' });
  });
});

describe('launchd・host 限定', () => {
  it('launchd', () => {
    expect(
      judgeLaunchd({ code: 0, stdout: '\tstate = running\n\tpid = 1\n', stderr: '' }).status,
    ).toBe('ok');
    expect(judgeLaunchd({ code: 0, stdout: '\tstate = waiting\n', stderr: '' })).toEqual({
      status: 'ng',
      detail: 'state=waiting',
    });
    expect(judgeLaunchd({ code: 113, stdout: '', stderr: 'Could not find service' })).toEqual({
      status: 'ng',
      detail: 'not loaded',
    });
  });
  it('pgrep / sudoers / tmutil', () => {
    expect(judgePgrep({ code: 0 }).status).toBe('ok');
    expect(judgePgrep({ code: 1 })).toEqual({ status: 'ng', detail: 'no process' });
    expect(judgeSudoers({ code: 0 }).status).toBe('ok');
    expect(judgeSudoers({ code: 1 }).status).toBe('ng');
    expect(judgeTmutil({ code: 0, stdout: '[Excluded]\t/Users/t/.tart\n' }).status).toBe('ok');
    expect(judgeTmutil({ code: 0, stdout: '[Included]\t/Users/t/.tart\n' })).toEqual({
      status: 'ng',
      detail: 'not excluded',
    });
    expect(judgeTmutil({ code: 1, stdout: '' }).status).toBe('unknown');
  });
  it('ディスクの空き', () => {
    const df = (avail: number) =>
      `Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk3s1s1 1000000 500000 ${avail} 50% /\n`;
    expect(judgeDiskFree(df(400000))).toEqual({ status: 'ok', detail: 'free 40%' });
    expect(judgeDiskFree(df(100000))).toEqual({ status: 'ng', detail: 'free 10%' });
    expect(judgeDiskFree('').status).toBe('unknown');
  });
  it('ユーザー名は unknown で名前だけ', () => {
    expect(judgeUserName('taro')).toEqual({ status: 'unknown', detail: 'taro' });
  });
  it('detail は 80 文字まで', () => {
    expect(toCheck('disk.free', { status: 'ng', detail: 'x'.repeat(200) }).detail).toHaveLength(80);
    expect(toCheck('disk.free', { status: 'ok' })).toEqual({ key: 'disk.free', status: 'ok' });
  });
});

const SHARING_LIST =
  'List of Share Points\nname:\t\tworkspace\npath:\t\t/Users/t/workspace\n\tsmb:\t{\n    \t\tname:\tworkspace\n    \t\tguest access:\t0\n\t}\n';

describe('collectSetup（外部コマンドは偽物）', () => {
  function cfgFor(env: 'host' | 'vm1') {
    return buildConfig({
      env,
      settings: {
        base_url: 'https://mac.example.test',
        claude_path: '/opt/claude/bin/claude',
        tart_path: '/opt/homebrew/bin/tart',
        work_dir: '/Users/t/work/rc',
      },
      token: { client_id: 'a', client_secret: 'b' },
      home: '/Users/t',
      uid: 501,
      configDir: '/Users/t/.config/agentstation',
    });
  }
  const deps: SetupDeps = {
    probePort: async (port) => port === 22,
    readText: () => '{"env":{"DISABLE_AUTOUPDATER":"1"}}',
    exists: () => true,
    username: () => 'taro',
    home: () => '/Users/t',
  };
  const calls: string[][] = [];
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    const r = (stdout: string, code = 0): ExecResult => ({
      code,
      stdout,
      stderr: '',
      timedOut: false,
    });
    if (cmd === '/usr/bin/pmset') return r(PMSET);
    if (cmd === '/usr/bin/fdesetup') return r('FileVault is Off.\n');
    if (cmd === '/usr/bin/defaults' && args.includes('autoLoginUser')) return r('taro\n');
    if (cmd === '/usr/bin/defaults' && args.includes('AutoUpdate')) return r('', 1);
    if (cmd === '/usr/bin/defaults') return r('{\n AutomaticDownload = 0;\n}\n');
    if (cmd === '/sbin/route') return r('  interface: en0\n');
    if (cmd === '/usr/sbin/networksetup') return r('Hardware Port: Ethernet\nDevice: en0\n');
    if (cmd === '/usr/bin/readlink') return r('/var/db/timezone/zoneinfo/Asia/Tokyo\n');
    if (cmd === '/opt/claude/bin/claude')
      return r('{"loggedIn":true,"email":"someone@example.com"}');
    if (cmd === '/bin/launchctl')
      return args[1]?.endsWith('tart-vm2') ? r('', 113) : r('\tstate = running\n');
    if (cmd === '/usr/bin/pgrep') return r('123\n');
    if (cmd === '/usr/bin/sudo') return r('');
    if (cmd === '/usr/bin/tmutil') return r('[Excluded]\t/Users/t/.tart\n');
    if (cmd === '/usr/sbin/sharing') return r(SHARING_LIST);
    if (cmd === '/usr/bin/pwpolicy') return r('SMB-NT\n');
    if (cmd === '/bin/df')
      return r(
        'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/x 1000 500 400 50% /\n',
      );
    return r('', 1);
  };

  it('host：全キーを順に返し、秘密情報を含まない', async () => {
    calls.length = 0;
    const checks = await collectSetup('host', cfgFor('host'), run, deps);
    expect(checks.map((c) => c.key)).toEqual(setupKeysFor('host'));
    const by = Object.fromEntries(checks.map((c) => [c.key, c])) as Record<
      SetupCheckKey,
      (typeof checks)[number]
    >;
    expect(by['power.autorestartatconnect'].status).toBe('ok');
    expect(by['sharing.ssh'].status).toBe('ok');
    expect(by['sharing.vnc'].status).toBe('ng');
    // deps.probePort は 22 だけ開いている → 445 は閉じ
    expect(by['sharing.smb_workspace']).toEqual({
      key: 'sharing.smb_workspace',
      status: 'ng',
      detail: 'port 445 closed',
    });
    expect(by['update.macos_auto_install'].status).toBe('ng');
    expect(by['update.appstore_auto']).toEqual({
      key: 'update.appstore_auto',
      status: 'ng',
      detail: 'not set',
    });
    expect(by['network.ethernet'].status).toBe('ok');
    expect(by['claude.logged_in']).toEqual({ key: 'claude.logged_in', status: 'ok' });
    expect(by['claude.workdir']).toEqual({ key: 'claude.workdir', status: 'ok', detail: 'rc' });
    expect(by['launchd.vm1'].status).toBe('ok');
    expect(by['launchd.vm2']).toEqual({ key: 'launchd.vm2', status: 'ng', detail: 'not loaded' });
    expect(by['sudoers.shutdown'].status).toBe('ok');
    expect(by['timemachine.tart_excluded'].status).toBe('ok');
    expect(by['disk.free']).toEqual({ key: 'disk.free', status: 'ok', detail: 'free 40%' });
    expect(by['user.name']).toEqual({ key: 'user.name', status: 'unknown', detail: 'taro' });
    expect(findForbidden({ setup: checks })).toEqual([]);
    // sudo は -l（一覧）だけで、実行はしない
    expect(calls.find((c) => c[0] === '/usr/bin/sudo')).toEqual([
      '/usr/bin/sudo',
      '-n',
      '-l',
      '/sbin/shutdown',
      '-r',
      'now',
    ]);
    expect(calls.find((c) => c[0] === '/usr/bin/tmutil')).toEqual([
      '/usr/bin/tmutil',
      'isexcluded',
      '/Users/t/.tart',
    ]);
  });

  it('vm1：host 限定の項目は出ず、codex 未設定は skip', async () => {
    const cfg = { ...cfgFor('vm1'), labels: { ...cfgFor('vm1').labels, codex: null } };
    const checks = await collectSetup('vm1', cfg, run, deps);
    expect(checks.map((c) => c.key)).toEqual(setupKeysFor('vm1'));
    expect(checks.map((c) => c.key)).not.toContain('launchd.vm1');
    expect(checks.find((c) => c.key === 'launchd.codex')).toEqual({
      key: 'launchd.codex',
      status: 'skip',
      detail: 'not configured',
    });
  });
});
