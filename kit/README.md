# 導入キット

このリポジトリを自分の Mac・Cloudflare アカウント・ドメインで立ち上げ、上流の更新を取り込み続けるための道具。始め方はリポジトリ直下の `README.md`。

## 考え方

- リポジトリ（`main`）は見本の値（`example.com`、利用者 Taro / Hanako / Jiro）のまま使う。**導入先でファイルを書き換えない。**
- 導入先の値は `kit/site.json` だけに書く。デプロイのときに `kit/render-config.mjs` がそこから本番の Worker の設定（`worker/wrangler.deploy.toml`）を作る。画面は Worker の設定 `SITE_JSON` から名前・ドメインなどを出す。
- `kit/site.json` と `worker/wrangler.deploy.toml` は `.gitignore` 済み。`kit/site.json` は秘密ではないが導入先の構成そのものなので、private な場所にも控えておく。
- 上流の更新は `git pull` してデプロイし直すだけ。コードを直したいときは上流に PR を送る。

## 中身

| ファイル                | 役割                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `kit/START.md`          | Claude Code が従う導入手順（前提の確認 → Cloudflare → Worker → host → VM → 利用者 → 仕上げ → 更新の取り込み）            |
| `kit/site.example.json` | 導入先の値の雛形。`kit/site.json` にコピーして埋める。秘密情報は入れない                                                 |
| `kit/render-config.mjs` | `site.json` を検証し、本番の Worker の設定を作る（`--check` で検証だけ）。`npm run deploy --workspace worker` が先に呼ぶ |
| `kit/lessons.md`        | 元の構成を作ったときに分かったはまりどころ                                                                               |

## `site.json` の項目

| キー                      | 意味                                                                                                  | 例                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `org_name` / `org_footer` | 画面・ガイドに出る組織名 / フッター                                                                   | `Example` / `Example Inc.`           |
| `domain`                  | Cloudflare に置いたドメイン（SSH / VNC は `ssh-host.<domain>` など）                                  | `example.com`                        |
| `dashboard_host`          | ダッシュボードのホスト名（`domain` の 1 階層下）                                                      | `workstation.example.com`            |
| `access_team`             | Zero Trust のチーム名                                                                                 | `example`                            |
| `timezone`                | 表示用タイムゾーン                                                                                    | `Asia/Tokyo`                         |
| `people.host / vm1 / vm2` | 表示名・macOS のユーザー名・Google ログインのメール。host は必須、vm1 / vm2 は使う VM だけ（0〜2 台） | `Taro` / `taro` / `taro@example.com` |
| `viewers`                 | 閲覧だけの人のメール                                                                                  | `[]`                                 |
| `cloudflare.*`            | D1 の ID、Access の AUD タグ 2 つ、SwitchBot の deviceId（分かった段階で埋める。秘密ではない）        |                                      |

## 設定で変えられないもの

- launchd のラベル（`co.bridgeui.agentstation.*`）、設定の置き場（`~/.config/agentstation`）、VM の IP（`192.168.64.10` / `.11`）は導入先によらず固定
- ロゴ（`worker/public/logo.png`）とガイドの画面写真は見本のもの（TODO：ロゴを設定で持つ）
