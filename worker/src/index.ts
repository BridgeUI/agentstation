import type { Bindings } from './env.js';
import { handleApi } from './api/router.js';
import { runCron } from './cron/index.js';
import { manifest } from './manifest.js';

export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return handleApi(request, env, ctx);
    }
    // ホーム画面のショートカットに、使っている環境と名前を入れる（SITE_JSON・MEMBERS_JSON）
    if (url.pathname === '/manifest.webmanifest') return manifest(request, env);
    // それ以外は静的アセット（wrangler.toml の [assets]）
    return env.ASSETS.fetch(request);
  },

  async scheduled(
    _controller: ScheduledController,
    env: Bindings,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(runCron(env));
  },
} satisfies ExportedHandler<Bindings>;
