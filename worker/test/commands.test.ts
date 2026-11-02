import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { claimCommands, expireStaleCommands, getCommand, insertCommand } from '../src/db.js';
import {
  agentToken,
  api,
  hostHeartbeat,
  mockJwks,
  userToken,
  uuid,
  vmHeartbeat,
} from './helpers.js';

beforeAll(mockJwks);

describe('指示の流れ', () => {
  it('queued → ハートビートで running（1回だけ）→ result で done', async () => {
    const user = await userToken('hanako@example.test');
    const agent = await agentToken('tok-vm1');
    const id = uuid();

    const created = await api('/api/commands', {
      token: user,
      body: { id, env: 'vm1', action: 'rc_restart' },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      id,
      env: 'vm1',
      executor: 'vm1',
      status: 'queued',
      requested_by: 'hanako@example.test',
    });

    // 画面には active として見える
    const status = await api('/api/status', { token: user });
    const vm1 = (status.body.envs as { env: string; active: { id: string } | null }[]).find(
      (e) => e.env === 'vm1',
    );
    expect(vm1?.active?.id).toBe(id);

    // 1回目のハートビートで渡され running になる
    const hb1 = await api('/api/agent/heartbeat', { token: agent, body: vmHeartbeat('vm1') });
    expect(hb1.status).toBe(200);
    expect(
      (hb1.body.commands as { id: string; status: string }[]).map((c) => [c.id, c.status]),
    ).toEqual([[id, 'running']]);

    // 2回目では渡されない（二重実行防止）
    const hb2 = await api('/api/agent/heartbeat', { token: agent, body: vmHeartbeat('vm1') });
    expect(hb2.body.commands).toEqual([]);

    // 別の環境のエージェントは結果を返せない
    const wrong = await api('/api/agent/result', {
      token: await agentToken('tok-vm2'),
      body: { id, status: 'done' },
    });
    expect(wrong.status).toBe(409);

    const done = await api('/api/agent/result', {
      token: agent,
      body: { id, status: 'done', output: '再起動した' },
    });
    expect(done.status).toBe(200);
    expect((await getCommand(env.DB, id))?.status).toBe('done');

    // 2回目の result は 409
    expect(
      (await api('/api/agent/result', { token: agent, body: { id, status: 'done' } })).status,
    ).toBe(409);

    // 監査ログに create / running / done が残る
    const audit = await api('/api/audit', { token: user });
    const actions = (audit.body as unknown as { action: string }[]).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(['command.create', 'command.running', 'command.done']),
    );
  });

  it('同じ環境に実行中の指示があれば 409、同じ id の再送は 200 で同じ内容', async () => {
    const user = await userToken('hanako@example.test');
    const id = uuid();
    expect(
      (await api('/api/commands', { token: user, body: { id, env: 'vm1', action: 'rc_restart' } }))
        .status,
    ).toBe(201);
    const again = await api('/api/commands', {
      token: user,
      body: { id, env: 'vm1', action: 'rc_restart' },
    });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(id);
    const other = await api('/api/commands', {
      token: user,
      body: { id: uuid(), env: 'vm1', action: 'claude_update' },
    });
    expect(other.status).toBe(409);
  });

  it('vm_restart は host のエージェントが実行する', async () => {
    const user = await userToken('jiro@example.test');
    const id = uuid();
    const r = await api('/api/commands', {
      token: user,
      body: { id, env: 'vm2', action: 'vm_restart' },
    });
    expect(r.status).toBe(201);
    expect(r.body.executor).toBe('host');
    // vm2 のエージェントには渡されない
    const hbVm = await api('/api/agent/heartbeat', {
      token: await agentToken('tok-vm2'),
      body: vmHeartbeat('vm2'),
    });
    expect(hbVm.body.commands).toEqual([]);
    const hbHost = await api('/api/agent/heartbeat', {
      token: await agentToken('tok-host'),
      body: hostHeartbeat(),
    });
    expect((hbHost.body.commands as { id: string }[]).map((c) => c.id)).toEqual([id]);
  });

  it('取り消しは queued のときだけ。本人・オーナー以外は 403', async () => {
    const hanako = await userToken('hanako@example.test');
    const jiro = await userToken('jiro@example.test');
    const id = uuid();
    await api('/api/commands', { token: hanako, body: { id, env: 'vm1', action: 'rc_restart' } });
    expect((await api(`/api/commands/${id}/cancel`, { token: jiro, method: 'POST' })).status).toBe(
      403,
    );
    const canceled = await api(`/api/commands/${id}/cancel`, { token: hanako, method: 'POST' });
    expect(canceled.status).toBe(200);
    expect(canceled.body.status).toBe('canceled');
    expect(
      (await api(`/api/commands/${id}/cancel`, { token: hanako, method: 'POST' })).status,
    ).toBe(409);
    expect(
      (await api(`/api/commands/${uuid()}/cancel`, { token: hanako, method: 'POST' })).status,
    ).toBe(404);
    // 取り消し後は新しい指示を受け付ける
    expect(
      (
        await api('/api/commands', {
          token: hanako,
          body: { id: uuid(), env: 'vm1', action: 'rc_restart' },
        })
      ).status,
    ).toBe(201);
  });

  it('session_restore は session_id が必要。他のキーは捨てる', async () => {
    const user = await userToken('hanako@example.test');
    expect(
      (
        await api('/api/commands', {
          token: user,
          body: { id: uuid(), env: 'vm1', action: 'session_restore' },
        })
      ).status,
    ).toBe(400);
    const r = await api('/api/commands', {
      token: user,
      body: {
        id: uuid(),
        env: 'vm1',
        action: 'session_restore',
        args: { session_id: 'abc', cmd: 'rm -rf /' },
      },
    });
    expect(r.status).toBe(201);
    expect(r.body.args).toEqual({ session_id: 'abc' });
  });

  it('rc_permission_set は bypassPermissions / default だけ', async () => {
    const user = await userToken('hanako@example.test');
    expect(
      (
        await api('/api/commands', {
          token: user,
          body: {
            id: uuid(),
            env: 'vm1',
            action: 'rc_permission_set',
            args: { permission_mode: 'plan' },
          },
        })
      ).status,
    ).toBe(400);
    const r = await api('/api/commands', {
      token: user,
      body: {
        id: uuid(),
        env: 'vm1',
        action: 'rc_permission_set',
        args: { permission_mode: 'default', extra: 1 },
      },
    });
    expect(r.status).toBe(201);
    expect(r.body.args).toEqual({ permission_mode: 'default' });
  });

  it('claude_permission_set は bypassPermissions / default だけ。他人の環境には出せない', async () => {
    const user = await userToken('hanako@example.test');
    expect(
      (
        await api('/api/commands', {
          token: user,
          body: {
            id: uuid(),
            env: 'vm1',
            action: 'claude_permission_set',
            args: { permission_mode: 'acceptEdits' },
          },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await api('/api/commands', {
          token: user,
          body: {
            id: uuid(),
            env: 'vm2',
            action: 'claude_permission_set',
            args: { permission_mode: 'bypassPermissions' },
          },
        })
      ).status,
    ).toBe(403);
    const r = await api('/api/commands', {
      token: user,
      body: {
        id: uuid(),
        env: 'vm1',
        action: 'claude_permission_set',
        args: { permission_mode: 'bypassPermissions', path: '/etc/passwd' },
      },
    });
    expect(r.status).toBe(201);
    expect(r.body.args).toEqual({ permission_mode: 'bypassPermissions' });
  });

  it('rc_mkdir は dir がフォルダ名のときだけ。start は true のときだけ残し、他のキーは捨てる', async () => {
    const user = await userToken('hanako@example.test');
    expect(
      (
        await api('/api/commands', {
          token: user,
          body: { id: uuid(), env: 'vm1', action: 'rc_mkdir', args: { dir: '../x' } },
        })
      ).status,
    ).toBe(400);
    const r = await api('/api/commands', {
      token: user,
      body: {
        id: uuid(),
        env: 'vm1',
        action: 'rc_mkdir',
        args: { dir: 'new-proj', start: true, cmd: 'rm -rf /' },
      },
    });
    expect(r.status).toBe(201);
    expect(r.body.args).toEqual({ dir: 'new-proj', start: true });
  });
});

describe('ホスト再起動', () => {
  it('オーナーだけ。ホスト名の入力が要り、1分の猶予の間は渡されず、取り消せる', async () => {
    const owner = await userToken('taro@example.test');
    const host = await agentToken('tok-host');
    const id = uuid();
    expect(
      (
        await api('/api/commands', {
          token: owner,
          body: { id, env: 'host', action: 'host_restart' },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await api('/api/commands', {
          token: owner,
          body: { id, env: 'host', action: 'host_restart', confirm_text: 'HOST' },
        })
      ).status,
    ).toBe(400);
    const r = await api('/api/commands', {
      token: owner,
      body: { id, env: 'host', action: 'host_restart', confirm_text: 'host' },
    });
    expect(r.status).toBe(201);
    const notBefore = r.body.not_before as number;
    expect(notBefore - (r.body.created_at as number)).toBe(60_000);
    expect((r.body.expires_at as number) - notBefore).toBe(600_000);

    // 猶予中はエージェントに渡されない
    const hb = await api('/api/agent/heartbeat', { token: host, body: hostHeartbeat() });
    expect(hb.body.commands).toEqual([]);

    // 猶予を過ぎたら渡される（時刻を進めて直接確認）
    const later = notBefore + 1000;
    expect((await claimCommands(env.DB, 'host', later)).map((c) => c.id)).toEqual([id]);
  });

  it('登録から15分を過ぎた host_restart は渡さず、古い指示で再起動ループにしない', async () => {
    const now = Date.now();
    const old = uuid();
    await insertCommand(env.DB, {
      id: old,
      env: 'host',
      executor: 'host',
      action: 'host_restart',
      args: null,
      status: 'queued',
      requested_by: 'taro@example.test',
      created_at: now - 20 * 60_000,
      not_before: now - 19 * 60_000,
      expires_at: now + 60 * 60_000,
      started_at: null,
      finished_at: null,
      output: null,
    });
    expect(await claimCommands(env.DB, 'host', now)).toEqual([]);
  });
});

describe('期限切れ', () => {
  it('queued のまま expires_at を過ぎれば expired、running のまま30分で failed', async () => {
    const now = Date.now();
    const a = uuid();
    const b = uuid();
    await insertCommand(env.DB, {
      id: a,
      env: 'vm1',
      executor: 'vm1',
      action: 'rc_restart',
      args: null,
      status: 'queued',
      requested_by: 'k@example.test',
      created_at: now - 11 * 60_000,
      not_before: null,
      expires_at: now - 60_000,
      started_at: null,
      finished_at: null,
      output: null,
    });
    await insertCommand(env.DB, {
      id: b,
      env: 'vm2',
      executor: 'vm2',
      action: 'rc_restart',
      args: null,
      status: 'queued',
      requested_by: 'y@example.test',
      created_at: now - 40 * 60_000,
      not_before: null,
      expires_at: now + 60_000,
      started_at: null,
      finished_at: null,
      output: null,
    });
    await claimCommands(env.DB, 'vm2', now - 31 * 60_000);
    const r = await expireStaleCommands(env.DB, now);
    expect(r).toEqual({ expired: 1, timedOut: 1 });
    expect((await getCommand(env.DB, a))?.status).toBe('expired');
    expect((await getCommand(env.DB, b))?.status).toBe('failed');
  });
});

describe('ハートビートと状態', () => {
  it('セッションのタイトルは60文字に切られ、sessions API にだけ出る', async () => {
    const agent = await agentToken('tok-vm1');
    const longTitle = 'あ'.repeat(100);
    const hb = await api('/api/agent/heartbeat', {
      token: agent,
      body: vmHeartbeat('vm1', {
        sessions: [{ id: 's1', title: longTitle, started_at: Date.now() - 5000 }],
      }),
    });
    expect(hb.status).toBe(200);

    const owner = await userToken('taro@example.test');
    const sessions = await api('/api/sessions?env=vm1', { token: owner });
    const rows = sessions.body as unknown as { session_id: string; title: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe('あ'.repeat(60));

    // /api/status と D1 の heartbeats にはタイトルが無い
    const status = await api('/api/status', { token: owner });
    expect(JSON.stringify(status.body)).not.toContain('ああああ');
    const stored = await env.DB.prepare("SELECT payload FROM heartbeats WHERE env = 'vm1'").first<{
      payload: string;
    }>();
    expect(stored?.payload).not.toContain('ああああ');
    expect(JSON.parse(stored?.payload ?? '{}').sessions).toEqual([]);
  });

  it('host の報告から VM の見え方と警告を作り、host には peers が返る', async () => {
    const host = await agentToken('tok-host');
    const vm1 = await agentToken('tok-vm1');
    await api('/api/agent/heartbeat', {
      token: vm1,
      body: vmHeartbeat('vm1', {
        maintenance: { last_run_at: Date.now() - 60_000, last_result: 'busy' },
      }),
    });
    const hb = await api('/api/agent/heartbeat', {
      token: host,
      body: hostHeartbeat({
        host: {
          cpu_cores: 10,
          mem_total_gb: 24,
          disk_total_gb: 512,
          mem_used_gb: 22,
          disk_used_gb: 470,
        },
      }),
    });
    expect(hb.status).toBe(200);
    const peers = hb.body.peers as Record<string, { busy: boolean }>;
    expect(peers.vm1?.busy).toBe(true);
    expect(peers.vm2).toBeUndefined();

    const status = await api('/api/status', { token: await userToken('viewer@example.test') });
    const envs = status.body.envs as {
      env: string;
      liveness: string;
      vm_view: { vm_state: string } | null;
    }[];
    expect(envs.find((e) => e.env === 'host')?.liveness).toBe('ok');
    expect(envs.find((e) => e.env === 'vm1')?.vm_view?.vm_state).toBe('running');
    expect(envs.find((e) => e.env === 'vm2')?.vm_view?.vm_state).toBe('stopped');
    expect(envs.find((e) => e.env === 'vm2')?.liveness).toBe('unknown');
    const alerts = status.body.alerts as { level: string; message: string }[];
    expect(alerts.map((a) => a.level)).toEqual(['error', 'error']);
  });
});
