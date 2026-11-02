import { DEFAULT_SITE, parseSiteConfig, type Env, type Millis } from '@agentstation/shared';

/**
 * Slack Incoming Webhook への送信と本文の組み立て。
 * 本文に入れてよいのは環境名・状態・時刻（JST）・ダッシュボードへのリンクだけ（CLAUDE.md 3）。
 * ログ・パス・セッションのタイトル・メールアドレスの @ 以降は入れない。
 */

/** SITE_JSON が無いときのダッシュボードの URL（見本の値） */
export const DASHBOARD_URL = `https://${DEFAULT_SITE.dashboard_host}/`;

/** ダッシュボードの URL（SITE_JSON の dashboard_host） */
export function dashboardUrl(siteJson: string | undefined): string {
  return `https://${parseSiteConfig(siteJson).dashboard_host}/`;
}

/** 環境ページの URL（画面は /host.html, /vm1.html, /vm2.html の静的ページ） */
export function envPageUrl(env: Env, base = DASHBOARD_URL): string {
  return `${base}${env}.html`;
}

/** 環境の表示名。人の名前は MEMBERS_JSON（メール）からしか引けないので、マシン名で固定する */
export function envLabel(env: Env): string {
  return env === 'host' ? 'Mac（host）' : env;
}

/** メールアドレスの @ より前だけ（@ が無ければそのまま。空なら「不明」） */
export function localPart(email: string): string {
  const i = email.indexOf('@');
  const s = (i >= 0 ? email.slice(0, i) : email).trim();
  return s || '不明';
}

/** 2026-10-31 12:34 JST の形。Intl が使えない環境では +9 時間固定で組み立てる */
export function formatTime(ms: Millis, tz = 'Asia/Tokyo'): string {
  const d = new Date(ms);
  try {
    const parts = new Intl.DateTimeFormat('ja-JP', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const p = (t: Intl.DateTimeFormatPartTypes) => parts.find((x) => x.type === t)?.value ?? '';
    const hour = p('hour') === '24' ? '00' : p('hour');
    return `${p('year')}-${p('month')}-${p('day')} ${hour}:${p('minute')} ${tzSuffix(tz)}`;
  } catch {
    const j = new Date(ms + 9 * 60 * 60 * 1000);
    const z = (n: number) => String(n).padStart(2, '0');
    return `${j.getUTCFullYear()}-${z(j.getUTCMonth() + 1)}-${z(j.getUTCDate())} ${z(j.getUTCHours())}:${z(j.getUTCMinutes())} JST`;
  }
}

function tzSuffix(tz: string): string {
  return tz === 'Asia/Tokyo' ? 'JST' : tz;
}

/** 「15分」「2時間5分」「3日1時間」 */
export function formatDuration(ms: Millis): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60) return `${min}分`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return m ? `${h}時間${m}分` : `${h}時間`;
  const d = Math.floor(h / 24);
  const hh = h % 24;
  return hh ? `${d}日${hh}時間` : `${d}日`;
}

export interface SlackMessage {
  /** 1行目。例: 「Mac 応答なし」 */
  title: string;
  /** 補足の行（状態・時刻など）。パスやログは入れない */
  lines?: string[] | undefined;
  env?: Env;
  kind: 'alert' | 'recover' | 'info';
}

export function renderMessage(
  m: SlackMessage,
  now: Millis,
  tz?: string,
  base = DASHBOARD_URL,
): string {
  const mark =
    m.kind === 'alert'
      ? ':red_circle:'
      : m.kind === 'recover'
        ? ':large_green_circle:'
        : ':white_circle:';
  const lines = [`${mark} ${m.title}`, ...(m.lines ?? []), `時刻: ${formatTime(now, tz)}`];
  lines.push(m.env ? envPageUrl(m.env, base) : base);
  return lines.join('\n');
}

export interface Notifier {
  /** 送れたら true。未設定・失敗は false（呼び手は state を更新せず、次回に再送する） */
  send(m: SlackMessage): Promise<boolean>;
}

export function createSlackNotifier(
  webhookUrl: string | undefined,
  now: Millis,
  tz?: string,
  base = DASHBOARD_URL,
): Notifier {
  let warned = false;
  return {
    async send(m) {
      const text = renderMessage(m, now, tz, base);
      if (!webhookUrl) {
        if (!warned) {
          warned = true;
          console.warn('SLACK_WEBHOOK_URL が未設定のため通知を送らない');
        }
        console.warn(`[notify:skipped] ${m.title}`);
        return false;
      }
      try {
        const res = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) {
          console.error(`Slack への送信に失敗: HTTP ${res.status}（${m.title}）`);
          return false;
        }
        return true;
      } catch (e) {
        console.error(`Slack への送信に失敗: ${e instanceof Error ? e.message : String(e)}`);
        return false;
      }
    },
  };
}
