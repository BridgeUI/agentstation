# Worker の初回デプロイ手順

`workstation.example.com` に Worker（静的 UI＋API＋Cron）と D1 を出す（`docs/spec.md` 2章、4章）。設定の本体は `worker/wrangler.toml`。この文書は「Taro が埋める値」をどこから取ってどう入れるかの手順。

前提

- `example.com` の DNS が Cloudflare にある（`docs/verify.md` D-1）。カスタムドメインの前提
- Node.js 22 以上、`npm install` 済み（リポジトリのルートで）
- Cloudflare アカウントに Workers と D1 の権限がある（`wrangler login` するユーザー）

参考（公式）

- Wrangler の設定：https://developers.cloudflare.com/workers/wrangler/configuration/
- D1 のコマンド：https://developers.cloudflare.com/workers/wrangler/commands/d1/
- Secrets：https://developers.cloudflare.com/workers/configuration/secrets/
- カスタムドメイン：https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
- Version URL（preview_urls）：https://developers.cloudflare.com/workers/configuration/previews/

以下のコマンドはすべてリポジトリのルートで実行する（`--workspace worker` で Worker の設定を使う）。`npx wrangler ...` は `worker/` に `cd` してから。

---

## 1. ログイン

```bash
cd worker
npx wrangler login
npx wrangler whoami
```

期待：ブラウザで Cloudflare の認可画面 → `You are logged in with an OAuth Token`、`whoami` に Account Name と Account ID。Account ID は Access の API（`gateway_ca`）でも使うので控える。

## 2. D1 を作る → `database_id`

```bash
npx wrangler d1 create agentstation
```

期待：`database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"` を含む `[[d1_databases]]` の雛形が出る。

`worker/wrangler.toml` の `[[d1_databases]]` の `database_id`（今は `00000000-...`）をその値に置き換える。`binding = "DB"` と `database_name = "agentstation"` はそのまま。

確認：

```bash
npx wrangler d1 list
```

に `agentstation` が出る。

## 3. マイグレーションを本番に当てる

```bash
cd ..   # リポジトリのルートへ
npm run db:migrate:remote --workspace worker
```

期待：`db/migrations/0001_init.sql` が applied と出る。

確認：

```bash
cd worker
npx wrangler d1 migrations list agentstation --remote
npx wrangler d1 execute agentstation --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

期待：未適用の一覧が空。テーブル名に `heartbeats`、`commands`、`audit_log`、`sessions` など（`db/schema.sql` の一覧）が出る。

## 4. secret：Slack Webhook

通知の条件と本文は `docs/spec.md` 4.3（実装は `worker/src/cron/`）。本文には環境名・状態・時刻・ダッシュボードへのリンクだけが入る。

### 4-1 Slack 側：Incoming Webhook を作る（example の Slack で。Taro）

公式：https://api.slack.com/messaging/webhooks

1. 通知先のチャンネルを決めて作る（例：`#agentstation-alerts`。通知は 1 分ごとの Cron から来るので、雑談のチャンネルには流さない）
2. https://api.slack.com/apps › **Create New App** › **From scratch**。App Name は `agentstation`、ワークスペースは example
3. 左の **Incoming Webhooks** › **Activate Incoming Webhooks** をオン
4. 下の **Add New Webhook to Workspace** › 1 のチャンネルを選んで **Allow**
5. 表示された **Webhook URL**（`https://hooks.slack.com/services/T…/B…/…`）を控える。**この URL を知っている人は誰でもそのチャンネルに投稿できる**ので、秘密情報として扱う（チャット・リポジトリ・画面に貼らない。Taro のパスワードマネージャーへ）

要確認：example の Slack でアプリの作成が管理者の承認制になっている場合は、承認を待つ（`docs/spec.md` 11章）。

### 4-2 Worker に登録する

```bash
cd worker
npx wrangler secret put SLACK_WEBHOOK_URL
```

プロンプトに 4-1 の URL を貼る。

期待：`Success! Uploaded secret SLACK_WEBHOOK_URL`。初回で Worker がまだない場合は「Worker を作るか」と聞かれるので Yes（空の Worker が作られる）。secret の登録にデプロイのし直しは要らない（次のリクエストから効く）。

確認：

```bash
npx wrangler secret list
```

に `SLACK_WEBHOOK_URL`（値は出ない）。

### 4-3 届くことを確かめる

1. ダッシュボードの一覧（`https://workstation.example.com/`）を **オーナー（taro@example.com）** で開く。右上の「30秒ごとに自動更新」の横に **「Slack にテスト通知」** が出る（オーナー以外には出ない。サーバー側も 403）
2. 押す → ボタンの横に「Slack に送りました」→ チャンネルに `⚪ テスト通知（ダッシュボードから手で送信）` が届く。操作履歴にも「Slack にテスト通知 / 送信」が残る
3. 「未登録」と出たら 4-2 が済んでいない。「送信に失敗」と出たら URL が違うか、Slack 側で Webhook が取り消されている（4-1 をやり直して `secret put` し直す）

本番の条件で来ることの確認は `docs/runbook.md` 8 章の復旧訓練（host のエージェントを止めて 10 分以内に「Mac mini 応答なし」、戻すと「復旧」）。

### 4-4 URL が漏れたとき

Slack の App 設定（4-1 の画面）で該当の Webhook を **Remove** し、新しく作って `secret put` し直す。古い URL はその時点で無効になる。

### 4-5 secret：SwitchBot（スマートプラグ。`docs/spec.md` 6.1）

Mac mini の電源ケーブルに挟んだ SwitchBot プラグミニを、ダッシュボードから読む・入れ直すための認証情報。**token はアカウント内の全機器を操作できる**ので、Slack の Webhook と同じく秘密として扱う（Taro の既存アカウントを使う。2026-11-01 決定）。

1. SwitchBot アプリ › プロフィール › 設定 › **アプリバージョン** を 10 回タップ → **開発者オプション** が出る → **トークンを取得**。token と secret（クライアントシークレット）を控える
2. Worker に入れる：

```bash
cd worker
npx wrangler secret put SWITCHBOT_TOKEN
npx wrangler secret put SWITCHBOT_SECRET
```

3. 機器 ID（deviceId）を `worker/wrangler.toml` の `[vars]` の `SWITCHBOT_PLUG_DEVICE_ID` に入れてデプロイする。ID はアプリの機器の設定画面か、次で一覧から取る（token・secret を手元の端末で使う。結果にはアカウント内の全機器が出る）：

```bash
node -e '
const [token, secret] = [process.env.T, process.env.S];
const t = String(Date.now()), nonce = crypto.randomUUID();
const sign = require("crypto").createHmac("sha256", secret).update(token + t + nonce).digest("base64");
fetch("https://api.switch-bot.com/v1.1/devices", { headers: { Authorization: token, sign, t, nonce } })
  .then((r) => r.json()).then((j) => console.log(JSON.stringify(j.body?.deviceList, null, 1)));
' # 実行前に T=<token> S=<secret> を環境変数で渡す
```

期待：`deviceType` が `Plug Mini (JP)` の行の `deviceId`。

4. 1〜2 分で一覧の見出しに「電源プラグ オン · nnW」が出る。出ないときは `npx wrangler tail` で `[cron] スマートプラグ` の行を見る（token・sign は出ない）。「届かない」と出るならプラグの Wi‑Fi か token が違う

3 つが揃うまでは、画面にプラグの表示・操作は出ず、`host_power_cycle` は 503 を返す。→ 2026-11-01 登録・設定・デプロイ済み（機器 ID `<deviceId>`、アプリでの機器名「Mac mini」）。

## 5. `[vars]` を埋める

`worker/wrangler.toml` の `[vars]`。Access の値は `cloudflare/access/setup.md` を進めたあとに入る。初回デプロイの時点では `TODO` のままでよい（画面の API は 401 を返すだけ）。

| キー                   | 値の取り方                                                                                                                                              | 入れ方                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `ACCESS_TEAM_DOMAIN`   | Zero Trust の **Team name and domain**（`<team>.cloudflareaccess.com`）                                                                                 | `wrangler.toml` に書く（秘密ではない）                                                                     |
| `ACCESS_AUD_DASHBOARD` | Access アプリ `agentstation` › Configure › Additional settings › **Application Audience (AUD) Tag**                                                     | 同上                                                                                                       |
| `ACCESS_AUD_AGENT`     | Access アプリ `agentstation-api` の AUD Tag                                                                                                             | 同上                                                                                                       |
| `MEMBERS_JSON`         | `{"owner":"taro@example.com","envs":{"host":"taro@example.com","vm1":"<Hanako のメール>","vm2":"<Jiro のメール>"},"viewers":["<閲覧者のメール>", ...]}` | `wrangler.toml` に書く。メールは公開情報ではないので、コミットしたくなければ下の「コミットしない値」の方法 |
| `AGENT_TOKEN_NAMES`    | **各サービストークンの Client ID**（`{"host":"<host の Client ID>","vm1":"...","vm2":"..."}`）                                                          | **`wrangler.toml` に書かず** `wrangler secret put AGENT_TOKEN_NAMES` で入れる（下記）                      |
| `TZ_DISPLAY`           | `Asia/Tokyo`                                                                                                                                            | そのまま                                                                                                   |

### `AGENT_TOKEN_NAMES` について

`worker/src/auth.ts` はサービストークンの JWT の `common_name` と `AGENT_TOKEN_NAMES` の値を突き合わせる。Cloudflare の仕様では **`common_name` にはトークンの名前ではなく Client ID**（`CF-Access-Client-Id` の値、`xxxxxxxx....access`）が入る（公式：https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/ ）。

したがって `wrangler.toml` の現在の値（`agentstation-host` など＝トークン名）では **403「このサービストークンはどの環境にも対応していない」** になる。値を Client ID にする。

Client ID は Secret ではないが、Access の認証情報の片方なのでリポジトリにコミットしない。`[vars]` から `AGENT_TOKEN_NAMES` の行を消し（または TODO のコメントだけ残し）、secret として入れる：

```bash
npx wrangler secret put AGENT_TOKEN_NAMES
# プロンプトに 1 行で：{"host":"<host の Client ID>","vm1":"<vm1 の Client ID>","vm2":"<vm2 の Client ID>"}
```

Worker から見れば `env.AGENT_TOKEN_NAMES` は文字列として同じに見えるので、コードの変更は不要。`[vars]` と secret に同じ名前があるとデプロイ時に衝突する（要確認：どちらが勝つかは公式に明記なし）ので、必ず `[vars]` 側を消す。

### コミットしない値（`MEMBERS_JSON` など）

- 方法 1：`wrangler.toml` は `example.invalid` のままにして、`wrangler deploy --var MEMBERS_JSON:'{...}'` で上書きする（`--var` が設定ファイルより優先）。毎回付ける必要があるので `worker/package.json` の `deploy` スクリプトか `.env`（gitignore 済み）から読むシェルで包む
- 方法 2：Cloudflare ダッシュボード › Workers & Pages › `agentstation` › Settings › Variables and Secrets で入れる。ただし `wrangler deploy` のたびに `[vars]` の値で上書きされるので、方法 1 のほうが事故が少ない
- 方法 3：`wrangler secret put MEMBERS_JSON` で secret にする（`[vars]` から消す）。Worker のコードは変更不要。これが一番単純

推奨は方法 3（`MEMBERS_JSON` と `AGENT_TOKEN_NAMES` を secret にし、`wrangler.toml` には `ACCESS_TEAM_DOMAIN`・`ACCESS_AUD_*`・`TZ_DISPLAY` だけ残す）。採用するなら `worker/wrangler.toml` のコメントも直す（他の担当に申し送り）。

## 6. デプロイ

```bash
npx wrangler deploy --dry-run   # まずビルドだけ
npx wrangler deploy
```

期待：

```
Uploaded agentstation
Deployed agentstation triggers
  workstation.example.com (custom domain)
  schedule: * * * * *
```

`workers.dev` の URL が**出ない**こと（`workers_dev = false`）。`Version URL` も出ないこと（`preview_urls = false`）。

確認：

```bash
npx wrangler deployments list
```

## 7. カスタムドメイン `workstation.example.com`

`wrangler.toml` の `[[routes]] pattern = "workstation.example.com", custom_domain = true` により、デプロイ時に Cloudflare が `workstation.example.com` の DNS レコード（Worker 宛て、Proxied）を自動で作る。手で CNAME を作らない（既存の CNAME があると失敗する）。

確認：

- Cloudflare ダッシュボード › `example.com` › DNS › Records に `mac` の Worker レコード
- Workers & Pages › `agentstation` › Settings › Domains & Routes に `workstation.example.com`（Custom Domain）
- `curl -sI https://workstation.example.com/api/health`

期待（Access のアプリを作る前）：`HTTP/2 200`、本文に JSON（`{"ok":true,...}`）。

## 8. `workers.dev` と Preview URL が無効なことの確認

Workers & Pages › `agentstation` › Settings › Domains & Routes：

- `workers.dev` が **Disabled**
- **Preview URLs** が **Disabled**

```bash
curl -sI https://agentstation.<account-subdomain>.workers.dev/ | head -1
```

期待：`HTTP/2 404`（または名前解決できない）。`200` が返るならダッシュボードで `workers.dev` を Disable にして `wrangler deploy` し直す（`docs/spec.md` 9章「`*.workers.dev` は無効」）。

## 9. Access のアプリを作ったあとの再デプロイと確認

`cloudflare/access/setup.md` の 2 章・3 章で AUD と Client ID が取れたら：

```bash
# wrangler.toml の ACCESS_TEAM_DOMAIN / ACCESS_AUD_DASHBOARD / ACCESS_AUD_AGENT を埋める
npx wrangler secret put AGENT_TOKEN_NAMES
npx wrangler deploy
```

確認（順に）

| 確認                             | コマンド／操作                                                                                                                | 期待                                                                                                                                                                                                                |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| health                           | `curl -sI https://workstation.example.com/api/health \| head -1`                                                              | Access のアプリができたあとは `302`（`<team>.cloudflareaccess.com` へ）。未ログインでは Worker に届かない                                                                                                           |
| 画面のログイン                   | ブラウザで `https://workstation.example.com/`                                                                                 | Google のログイン → 画面。ログイン後 `/api/me` に自分のメールとロール                                                                                                                                               |
| 一覧外のメール                   | 別の Google アカウント                                                                                                        | Access の拒否画面。Worker に届かない                                                                                                                                                                                |
| エージェント API（未認証）       | `curl -si -X POST https://workstation.example.com/api/agent/heartbeat -H 'Content-Type: application/json' -d '{}' \| head -1` | Worker の `401` ではなく **Access が止める**（`401 Response for Service Auth policies` をオンにしていれば Access の `401`、オフなら `302`/`403` の Access ページ）。応答ヘッダに `cf-access-*` があれば Access 由来 |
| エージェント API（トークンあり） | `cloudflare/access/setup.md` 3-4                                                                                              | Worker の `400`（空ペイロード）。`401 JWT の aud が違う` なら `ACCESS_AUD_AGENT`、`403 ...どの環境にも対応していない` なら `AGENT_TOKEN_NAMES`                                                                      |
| Cron                             | `npx wrangler tail --format pretty` を開いて 1〜2 分待つ                                                                      | 毎分 `scheduled` の実行ログ。Slack に通知が来るのは条件を満たしたとき（`docs/spec.md` 4.3）                                                                                                                         |

## 10. 日常の更新

```bash
npm run typecheck && npm test --workspace worker
cd worker && npx wrangler deploy
```

secret は再デプロイで消えない。`wrangler.toml` の `[vars]` はデプロイのたびに上書きされる。ロールバックは Workers & Pages › Deployments から、または `npx wrangler rollback`。
