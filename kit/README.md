# 導入キット

このリポジトリを自分の Mac mini・Cloudflare アカウント・ドメインで立ち上げ、上流の更新を取り込み続けるための道具。始め方はリポジトリ直下の `README.md`。

## ブランチの考え方

- 上流（このリポジトリ）の `main` には見本の値（`example.com`、利用者 Taro / Hanako / Jiro など）が入っている。
- 導入先の値は `kit/site.json` に書き、`kit/personalize.mjs` で当てて **`deploy` ブランチ** に 1 コミットで持つ。メールアドレスや構成が入るので、置くなら自分の **private リポジトリ**（GitHub の public な fork にはしない）。
- 上流が更新されたら `kit/update.sh` が `deploy` を `upstream/main` から作り直す。毎回作り直すのでマージで困らない。コードを直したいときは上流に PR を送る。

## 中身

| ファイル                | 役割                                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `kit/START.md`          | Claude Code が従う導入手順（前提の確認 → 値の置き換え → Cloudflare → Worker → host → VM → 利用者 → 仕上げ → 更新の取り込み） |
| `kit/site.example.json` | 導入先の値の雛形。`kit/site.json` にコピーして埋める。秘密情報は入れない                                                     |
| `kit/personalize.mjs`   | `site.json` の値で、リポジトリに書かれた見本の値を置き換える（`--dry-run` で確認だけ）                                       |
| `kit/source.json`       | いまリポジトリに書かれている値。`personalize.mjs` が置き換え元として使い、実行後に更新する。手で直さない                     |
| `kit/update.sh`         | 上流の更新を `deploy` に取り込む                                                                                             |
| `kit/lessons.md`        | 元の構成を作ったときに分かったはまりどころ                                                                                   |

## `site.json` の項目

| キー                      | 意味                                                                                                  | 例                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `org_name` / `org_footer` | 画面・ガイドに出る組織名 / フッター                                                                   | `Example` / `Example Inc.`           |
| `domain`                  | Cloudflare に置いたドメイン                                                                           | `example.com`                        |
| `dashboard_host`          | ダッシュボードのホスト名（`domain` の 1 階層下）                                                      | `workstation.example.com`            |
| `access_team`             | Zero Trust のチーム名                                                                                 | `example`                            |
| `label_prefix`            | launchd のラベルの接頭辞（逆ドメイン）                                                                | `com.example`                        |
| `timezone`                | 表示用タイムゾーン                                                                                    | `Asia/Tokyo`                         |
| `people.host / vm1 / vm2` | 表示名・macOS のユーザー名・Google ログインのメール。host は必須、vm1 / vm2 は使う VM だけ（0〜2 台） | `Taro` / `taro` / `taro@example.com` |
| `viewers`                 | 閲覧だけの人のメール                                                                                  | `[]`                                 |
| `cloudflare.*`            | D1 の ID、Access の AUD タグ 2 つ、SwitchBot の deviceId（分かった段階で埋める。秘密ではない）        |                                      |

SSH / VNC のホスト名は `ssh-host.<domain>`、`vnc-vm1.<domain>` のように決まる。

## `personalize.mjs` が置き換えないもの

- `docs/` と `cloudflare/` の文書・コードのコメントの中の人名（見本の名前のまま。`kit/START.md` の読み替え表で読む）
- `design/`（参照用のモック）
- ロゴ（`worker/public/logo.png`）とガイドの画面写真（`worker/public/guide/*.jpg`）。差し替えたものは `update.sh` が引き継ぐ
