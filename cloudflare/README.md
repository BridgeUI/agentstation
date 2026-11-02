# Cloudflare 側の設定（テンプレート・手順書）

フェーズ7（`docs/tasks.md`）の成果物。Cloudflare のダッシュボード操作はコード化できないので手順書にし、cloudflared の設定だけテンプレートで持つ。秘密情報（トークン、Client Secret、Tunnel の credentials JSON、Slack Webhook）はここに書かない。置き場と扱い方だけ書く。

## 成果物

| ファイル                         | 内容                                                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `worker/setup.md`                | Worker の初回デプロイ。D1 作成、`wrangler.toml` の埋め方、secret、カスタムドメイン `workstation.example.com`、`workers.dev` 無効の確認                  |
| `cloudflared/config.yml.example` | host の `/etc/cloudflared/config.yml` のテンプレート（公開ホスト名 6 本＋404）。VM の IP はプレースホルダ                                               |
| `cloudflared/setup.md`           | Tunnel の作成、DNS ルート 6 本、内部ネットワーク `192.168.64.0/24` のルート、LaunchDaemon 化、動作確認                                                  |
| `access/setup.md`                | Zero Trust：Google IdP、ダッシュボードのアプリ、`/api/agent` の Service Auth とサービストークン 3 本、SSH×3・VNC×3 のブラウザ表示、SSH CA、ログでの検証 |
| `warp/setup.md`                  | 経路 B：端末登録、Split Tunnels、Gateway プロキシ、Access for Infrastructure（ターゲット 3 つ）、画面共有用の 5900 許可、利用者の手順、切り分け         |

## 進める順番

1. **Worker**（`worker/setup.md`）— `workstation.example.com` に Worker を出す。Access の AUD はまだ `TODO` のままでよい
2. **Tunnel**（`cloudflared/setup.md`）— host に cloudflared を常駐させ、公開ホスト名 6 本と内部ネットワークを登録
3. **Access**（`access/setup.md`）— IdP → ダッシュボードのアプリ → エージェント API → SSH/VNC → SSH CA。AUD と Client ID を `wrangler.toml` に戻して再デプロイ
4. **WARP**（`warp/setup.md`）— 経路 B。Split Tunnels を直さないと一切つながらない

各手順に「期待する結果」と「確認コマンド」を書いてある。UI の名称が違うときは「要確認」と公式 URL を頼りに読み替える。

## 他のディレクトリとの関係

- Worker の設定値：`worker/wrangler.toml`（`database_id`、`ACCESS_TEAM_DOMAIN`、`ACCESS_AUD_DASHBOARD`、`ACCESS_AUD_AGENT`、`AGENT_TOKEN_NAMES`、`MEMBERS_JSON`）。secret は `SLACK_WEBHOOK_URL`
- Mac 側の plist・sshd 断片：`mac/launchd/`、`mac/sshd/`
- 実機で確かめること：`docs/verify.md` B-2（VM の IP）、B-3（`192.168.64.1`）、D-1〜D-5
- 仕様：`docs/spec.md` 4.1（API と認証）、8章（SSH・画面共有）、9章（アクセス制御）、11章（未確認事項）

## 注意

- `common_name`：Access の JWT でサービストークンの `common_name` に入るのは**トークン名ではなく Client ID**。`AGENT_TOKEN_NAMES` には Client ID を入れる（`access/setup.md` 3 章）
- cloudflared 2023.9.0 以降は `warp-routing: enabled: true` を書かない（警告が出る）。内部ネットワークは `cloudflared tunnel route ip add` で登録する
- ブラウザ表示（経路 A）の SSH 用 CA はアプリごと、WARP（経路 B）用は Gateway SSH CA。各マシンの `/etc/ssh/ca.pub` に両方入れる
