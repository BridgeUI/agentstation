import { describe, expect, it } from 'vitest';
import { findForbidden, summarizeOutput } from '../src/send/filter.js';

describe('送信直前の秘密情報チェック', () => {
  it('パス・メール・API キー・JWT をキーのパスで返す（値は返さない）', () => {
    const hits = findForbidden({
      env: 'host',
      host: { os_version: '26.1' },
      claude: { version: '/Users/x/.local/bin/claude' },
      vms: [{ env: 'vm1', ip: '192.168.64.10' }, { note: 'mail me at someone@example.com' }],
      nested: { key: 'sk-ant-abcdefg123' },
      jwt: 'eyJabcdefghijk.eyJabcdefghijk.sig',
    });
    expect(hits).toEqual(['claude.version', 'vms[1].note', 'nested.key', 'jwt']);
    for (const h of hits) expect(h).not.toMatch(/example\.com|sk-ant|\/Users/);
  });
  it('sessions は対象外', () => {
    expect(
      findForbidden({ sessions: [{ id: 'a', title: '/Users/x/secret' }], claude: {} }),
    ).toEqual([]);
  });
  it('キー名も見る', () => {
    expect(findForbidden({ 'someone@example.com': 1 })).toEqual(['someone@example.com']);
  });
  it('きれいな host のハートビートは通る', () => {
    expect(
      findForbidden({
        env: 'host',
        agent_version: '0.1.0',
        claude: { state: 'running', rc_state: 'connected', version: '2.1.50' },
        host: { os_version: '26.1', tart_version: '2.27.1', cpu_cores: 10 },
        vms: [{ env: 'vm1', vm_state: 'running', ip: '192.168.64.10', usage: {}, alloc: {} }],
      }),
    ).toEqual([]);
  });
});

describe('結果の要約', () => {
  it('パスを落とし、空白をまとめ、500 文字で切る', () => {
    const s = summarizeOutput(
      'failed:   open /Users/taro/work/rc/x.txt\n and /opt/homebrew/bin/tart',
    );
    expect(s).toBe('failed: open <path> and <path>');
    expect(summarizeOutput('a'.repeat(700))).toHaveLength(500);
  });
  it('秘密情報らしきものが残れば本文を捨てる', () => {
    expect(summarizeOutput('token sk-ant-abc123')).toBe(
      '出力に秘密情報らしき文字列が含まれたため省略',
    );
    expect(summarizeOutput('mail someone@example.com')).toBe(
      '出力に秘密情報らしき文字列が含まれたため省略',
    );
  });
});
