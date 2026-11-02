import { loadConfig } from './config.js';
import { log } from './log.js';
import { AgentLoop } from './loop.js';

/**
 * 常駐の入口（docs/spec.md 3.6）。launchd の KeepAlive で動かす。
 *   node dist/index.js --env=host|vm1|vm2
 * ログは stdout / stderr（ローテーションは newsyslog）。SIGTERM で実行中の操作を待ってから止まる。
 */
function main(): void {
  const config = loadConfig(process.argv.slice(2));
  const loop = new AgentLoop({ cfg: config, log });
  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    log.info('停止シグナルを受信', { signal });
    void loop.stop().then(() => process.exit(0));
    // 操作が長引いても 30 秒で諦める
    setTimeout(() => process.exit(0), 30_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  loop.start();
}

try {
  main();
} catch (e) {
  log.error('agentstation 起動失敗', { reason: (e as Error).message });
  process.exit(1);
}
