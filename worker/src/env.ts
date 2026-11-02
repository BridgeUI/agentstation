/** wrangler.toml のバインディング。秘密情報は `wrangler secret` で入る。 */
export interface Bindings {
  DB: D1Database;
  ASSETS: Fetcher;
  MEMBERS_JSON: string;
  /** 導入先ごとの表示の値（名前・ドメイン・チーム名。shared/src/site.ts）。無ければ見本の値 */
  SITE_JSON?: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD_DASHBOARD: string;
  ACCESS_AUD_AGENT: string;
  TZ_DISPLAY: string;
  /** secret。環境 → サービストークンの Client ID（JWT の common_name に入る値） */
  AGENT_TOKEN_NAMES: string;
  /** secret */
  SLACK_WEBHOOK_URL?: string;
  /**
   * secret。環境 → VNC パスワード（'{"host":"…","vm1":"…","vm2":"…"}'）。押したときだけ本人・オーナーに返す（docs/spec.md 13章 #16）。
   * D1・ハートビート・ログには置かない。
   */
  VNC_PASSWORDS_JSON?: string;
  /**
   * secret。SwitchBot のクラウド API の token と secret（アプリの開発者オプションで取る。docs/spec.md 6.1）。
   * token はアカウント内の全機器を操作できるので、D1・ログ・画面には出さない。
   */
  SWITCHBOT_TOKEN?: string;
  SWITCHBOT_SECRET?: string;
  /** Mac の電源ケーブルに挟んだプラグの deviceId（wrangler.toml の [vars]）。3 つ揃って初めてプラグの機能が有効になる */
  SWITCHBOT_PLUG_DEVICE_ID?: string;
  /**
   * ローカル開発専用（.dev.vars に書く。本番には絶対に設定しない）。
   * リクエストのホストが localhost / 127.0.0.1 のときだけ、このメールでログインしたことにする。
   */
  LOCAL_DEV_EMAIL?: string;
}
