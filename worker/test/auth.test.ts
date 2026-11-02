import { beforeAll, describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';
import { agentToken, api, mockJwks, sign, userToken, uuid, vmHeartbeat } from './helpers.js';

beforeAll(mockJwks);

describe('認証', () => {
  it('JWT が無ければ 401', async () => {
    expect((await api('/api/me')).status).toBe(401);
    expect((await api('/api/agent/heartbeat', { body: vmHeartbeat('vm1') })).status).toBe(401);
  });

  it('aud が違えば 401（画面用トークンでエージェント API は呼べない）', async () => {
    const r = await api('/api/agent/heartbeat', {
      token: await userToken('taro@example.test'),
      body: vmHeartbeat('vm1'),
    });
    expect(r.status).toBe(401);
    const r2 = await api('/api/me', { token: await agentToken('tok-vm1') });
    expect(r2.status).toBe(401);
  });

  it('期限切れ・署名鍵違い・iss 違いは 401', async () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    expect(
      (
        await api('/api/me', {
          token: await sign({ aud: ['aud-dashboard'], email: 'taro@example.test', exp: past }),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await api('/api/me', {
          token: await sign(
            { aud: ['aud-dashboard'], email: 'taro@example.test' },
            { kid: 'unknown' },
          ),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await api('/api/me', {
          token: await sign({
            aud: ['aud-dashboard'],
            email: 'taro@example.test',
            iss: 'https://evil.example',
          }),
        })
      ).status,
    ).toBe(401);
  });

  it('POST は JSON 必須', async () => {
    const res = await SELF.fetch('https://mac.example.test/api/commands', {
      method: 'POST',
      headers: {
        'Cf-Access-Jwt-Assertion': await userToken('taro@example.test'),
        'content-type': 'text/plain',
      },
      body: 'x',
    });
    expect(res.status).toBe(415);
  });
});

describe('ロール', () => {
  it('/api/me はメールからロールを返す', async () => {
    const owner = await api('/api/me', { token: await userToken('taro@example.test') });
    expect(owner.body).toMatchObject({ role: 'owner', envs: ['host', 'vm1', 'vm2'] });
    const member = await api('/api/me', { token: await userToken('Hanako@Example.test') });
    expect(member.body).toMatchObject({ role: 'member', envs: ['vm1'] });
    const viewer = await api('/api/me', { token: await userToken('someone@example.test') });
    expect(viewer.body).toMatchObject({ role: 'viewer', envs: [] });
  });

  it('閲覧者は状態と履歴は見えるが、操作とセッションは 403', async () => {
    const t = await userToken('viewer@example.test');
    expect((await api('/api/status', { token: t })).status).toBe(200);
    expect((await api('/api/audit', { token: t })).status).toBe(200);
    expect((await api('/api/sessions?env=vm1', { token: t })).status).toBe(403);
    const r = await api('/api/commands', {
      token: t,
      body: { id: uuid(), env: 'vm1', action: 'rc_restart' },
    });
    expect(r.status).toBe(403);
  });

  it('本人は自分の環境だけ操作できる。他人の環境とホスト再起動は 403', async () => {
    const t = await userToken('hanako@example.test');
    expect(
      (
        await api('/api/commands', {
          token: t,
          body: { id: uuid(), env: 'vm1', action: 'rc_restart' },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await api('/api/commands', {
          token: t,
          body: { id: uuid(), env: 'vm2', action: 'rc_restart' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await api('/api/commands', {
          token: t,
          body: { id: uuid(), env: 'host', action: 'host_restart', confirm_text: 'host' },
        })
      ).status,
    ).toBe(403);
    expect((await api('/api/sessions?env=vm1', { token: t })).status).toBe(200);
    expect((await api('/api/sessions?env=vm2', { token: t })).status).toBe(403);
  });

  it('ホワイトリスト外の action と対象外の環境は 400', async () => {
    const t = await userToken('taro@example.test');
    expect(
      (await api('/api/commands', { token: t, body: { id: uuid(), env: 'host', action: 'rm_rf' } }))
        .status,
    ).toBe(400);
    expect(
      (
        await api('/api/commands', {
          token: t,
          body: { id: uuid(), env: 'host', action: 'vm_restart' },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await api('/api/commands', {
          token: t,
          body: { id: 'not-a-uuid', env: 'host', action: 'rc_restart' },
        })
      ).status,
    ).toBe(400);
  });
});

describe('エージェントの認証', () => {
  it('vm1 のトークンで host を名乗れない', async () => {
    const r = await api('/api/agent/heartbeat', {
      token: await agentToken('tok-vm1'),
      body: { ...vmHeartbeat('vm1'), env: 'host' },
    });
    expect(r.status).toBe(403);
  });

  it('知らない common_name は 403', async () => {
    const r = await api('/api/agent/heartbeat', {
      token: await agentToken('tok-other'),
      body: vmHeartbeat('vm1'),
    });
    expect(r.status).toBe(403);
  });

  it('パスやメールが混ざったハートビートは 400', async () => {
    const t = await agentToken('tok-vm1');
    const r = await api('/api/agent/heartbeat', {
      token: t,
      body: vmHeartbeat('vm1', { guest: { os_version: '/Users/hanako/work' } }),
    });
    expect(r.status).toBe(400);
    const r2 = await api('/api/agent/heartbeat', {
      token: t,
      body: vmHeartbeat('vm1', {
        claude: { state: 'running', rc_state: 'login_required', version: 'hanako@example.test' },
      }),
    });
    expect(r2.status).toBe(400);
  });
});
