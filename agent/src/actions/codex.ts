import { serviceTarget } from '../collect/launchctl.js';
import { summarizeOutput } from '../send/filter.js';
import { failOutcome, okOutcome, type ActionContext, type ActionOutcome } from './context.js';

/**
 * codex_restart。ChatGPT デスクトップアプリ（codex_app）なら「終了 → 開き直す」、launchd の daemon なら kickstart。
 * アプリ名は bundle 名から（/Applications/ChatGPT.app → ChatGPT）。任意の文字列はシェルに渡さない（引数配列だけ）。
 */
export async function codexRestart(ctx: ActionContext): Promise<ActionOutcome> {
  const app = ctx.cfg.codexApp;
  if (app !== null) {
    const name =
      app
        .replace(/\/$/, '')
        .split('/')
        .pop()
        ?.replace(/\.app$/, '') ?? 'ChatGPT';
    const running = async (): Promise<boolean> =>
      (await ctx.run('/usr/bin/pgrep', ['-f', `${app}/Contents/MacOS/`], { timeoutMs: 10_000 }))
        .code === 0;
    await ctx.run('/usr/bin/osascript', ['-e', `tell application "${name}" to quit`], {
      timeoutMs: 20_000,
    });
    // 終了し切る前に open すると空振りする（実機で確認）。消えるまで最大 20 秒待つ
    for (let i = 0; i < 20 && (await running()); i++) await ctx.sleep(1000);
    if (await running()) return failOutcome(`${name} が終了しない`);
    const o = await ctx.run('/usr/bin/open', ['-a', app], { timeoutMs: 30_000 });
    if (o.code !== 0)
      return failOutcome(`アプリを開けなかった (code=${o.code}) ${summarizeOutput(o.stderr)}`);
    for (let i = 0; i < 15 && !(await running()); i++) await ctx.sleep(1000);
    if (!(await running())) return failOutcome(`${name} を開いたが起動を確認できない`);
    return okOutcome(`${name} アプリを開き直した`);
  }
  const label = ctx.cfg.labels.codex;
  if (label === null) return failOutcome('この環境では Codex の常駐が設定されていない');
  const r = await ctx.run(
    '/bin/launchctl',
    ['kickstart', '-k', serviceTarget(ctx.cfg.uid, label)],
    {
      timeoutMs: 30_000,
    },
  );
  if (r.code !== 0)
    return failOutcome(`kickstart 失敗 (code=${r.code}) ${summarizeOutput(r.stderr)}`);
  return okOutcome('Codex を再起動した');
}
