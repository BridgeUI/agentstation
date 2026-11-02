import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * テストは Workers ランタイム（miniflare）で動かし、D1 も本物を使う。
 * Access の JWKS はテスト側で fetch を差し替えて返す（test/helpers.ts）。
 * 署名用の鍵は TEST_PRIVATE_JWK としてテストに渡す（公開鍵の n・e も含む）。
 */
const TEAM = 'team.cloudflareaccess.com';
const KID = 'test-key-1';

export default defineConfig(async () => {
  const migrations = await readD1Migrations(
    fileURLToPath(new URL('../db/migrations', import.meta.url)),
  );
  const keyPair = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const priv = (await crypto.subtle.exportKey('jwk', keyPair.privateKey)) as JsonWebKey;

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            TEST_PRIVATE_JWK: JSON.stringify({ ...priv, kid: KID }),
            ACCESS_TEAM_DOMAIN: TEAM,
            ACCESS_AUD_DASHBOARD: 'aud-dashboard',
            ACCESS_AUD_AGENT: 'aud-agent',
            AGENT_TOKEN_NAMES: '{"host":"tok-host","vm1":"tok-vm1","vm2":"tok-vm2"}',
            MEMBERS_JSON:
              '{"owner":"taro@example.test","envs":{"host":"taro@example.test","vm1":"hanako@example.test","vm2":"jiro@example.test"},"viewers":["viewer@example.test"]}',
          },
        },
      }),
    ],
    test: {
      include: ['test/**/*.test.ts'],
      setupFiles: ['./test/setup.ts'],
      // D1 のファイルを共有するので、テストファイルは直列に動かす
      fileParallelism: false,
    },
  };
});
