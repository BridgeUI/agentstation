import { describe, expect, it } from 'vitest';
import { FORBIDDEN_PATTERNS, SESSION_TITLE_MAX } from '@macmini/shared';
import { buildHeartbeat, trimSession } from '../src/collect/heartbeat.js';
import { findForbidden } from '../src/send/filter.js';
import { AGENT_VERSION } from '../src/version.js';
import pkg from '../package.json' with { type: 'json' };

const claude = { state: 'running', rc_state: 'connected', version: '2.1.50' } as const;
const codex = { state: 'running' } as const;

describe('ハートビートの組み立て（docs/spec.md 4.4）', () => {
  it('vm の形', () => {
    const hb = buildHeartbeat({
      env: 'vm1',
      agentVersion: '0.1.0',
      agentStartedAt: 1,
      sentAt: 2,
      claude,
      codex,
      sessions: [{ id: 'abc', title: 'x'.repeat(100), started_at: 3 }],
      maintenance: { last_run_at: 4, last_result: 'updated' },
      guest: { os_version: '26.1', boot_at: 5, disk_used_gb: 41, disk_total_gb: 90 },
    });
    expect(hb).toEqual({
      env: 'vm1',
      agent_version: '0.1.0',
      agent_started_at: 1,
      sent_at: 2,
      claude,
      codex,
      sessions: [{ id: 'abc', title: 'x'.repeat(SESSION_TITLE_MAX), started_at: 3 }],
      maintenance: { last_run_at: 4, last_result: 'updated' },
      guest: { os_version: '26.1', boot_at: 5, disk_used_gb: 41, disk_total_gb: 90 },
    });
    expect(findForbidden(hb)).toEqual([]);
  });
  it('host の形（maintenance が無ければキーも無い）', () => {
    const hb = buildHeartbeat({
      env: 'host',
      agentVersion: '0.1.0',
      agentStartedAt: 1,
      sentAt: 2,
      claude,
      codex,
      sessions: [],
      host: { os_version: '26.1', cpu_cores: 10, mem_total_gb: 24, cpu_pct: 38 },
      vms: [
        {
          env: 'vm1',
          vm_state: 'running',
          ip: '192.168.64.10',
          usage: { cpu_pct_of_host: 20, mem_gb: 5.8, disk_image_gb: 41 },
          alloc: { cpu: 4, mem_gb: 6, disk_gb: 90 },
        },
      ],
    });
    expect(hb.env).toBe('host');
    expect('maintenance' in hb).toBe(false);
    expect('guest' in hb).toBe(false);
    expect(JSON.stringify(hb)).not.toMatch(/undefined/);
    const text = JSON.stringify({ ...hb, sessions: undefined });
    expect(FORBIDDEN_PATTERNS.some((p) => p.test(text))).toBe(false);
  });
  it('セッションのタイトルは 60 文字（サロゲートペアも 1 文字）', () => {
    const t = trimSession({ id: 'a', title: '😀'.repeat(70) });
    expect([...(t.title ?? '')]).toHaveLength(60);
    expect(trimSession({ id: 'a' })).toEqual({ id: 'a' });
  });
});

describe('バージョン', () => {
  it('package.json と一致する', () => {
    expect(AGENT_VERSION).toBe(pkg.version);
  });
});
