import { authenticateUser } from '../auth.js';
import { dashboardUrl, createSlackNotifier, localPart } from '../cron/slack.js';
import { audit } from '../db.js';
import type { Bindings } from '../env.js';
import { HttpError, json } from '../http.js';

/**
 * POST /api/notify/test：Slack にテスト通知を送る（オーナーだけ）。
 * `wrangler secret put SLACK_WEBHOOK_URL` のあと、Cron の条件を待たずに届くことを確かめるため。
 * 本文はテストである旨と押した人の名前（@ の前）だけ。Webhook の URL は応答にもログにも出さない。
 */
export async function postNotifyTest(request: Request, env: Bindings): Promise<Response> {
  const me = await authenticateUser(request, env);
  if (me.role !== 'owner') throw new HttpError(403, 'オーナーだけが送れる');
  if (!env.SLACK_WEBHOOK_URL) {
    throw new HttpError(
      503,
      'Slack の Webhook が未登録（wrangler secret put SLACK_WEBHOOK_URL で登録する）',
    );
  }
  const now = Date.now();
  const notifier = createSlackNotifier(
    env.SLACK_WEBHOOK_URL,
    now,
    env.TZ_DISPLAY,
    dashboardUrl(env.SITE_JSON),
  );
  const ok = await notifier.send({
    title: 'テスト通知（ダッシュボードから手で送信）',
    lines: [`送信: ${localPart(me.email)}`],
    kind: 'info',
  });
  await audit(env.DB, me.email, 'notify.test', null, ok ? 'sent' : 'failed', now);
  if (!ok) throw new HttpError(502, 'Slack への送信に失敗した（Webhook の URL を確認する）');
  return json({ sent: true, at: now });
}
