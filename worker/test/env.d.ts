import type { D1Migration } from 'cloudflare:test';
import type { Bindings } from '../src/env.js';

declare global {
  namespace Cloudflare {
    interface Env extends Bindings {
      TEST_MIGRATIONS: D1Migration[];
      /** vitest.config.ts が作った署名用の秘密鍵（JWK） */
      TEST_PRIVATE_JWK: string;
    }
  }
}

export {};
