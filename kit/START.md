# 導入の進め方（Claude Code 向け）

このリポジトリを **導入する人（以下「導入者」。Mac 本体＝host を使うオーナー）が、自分の Mac と Cloudflare アカウントで立ち上げる** ときに、Claude Code が上から順に従う手順。

## 0. 役割と約束

**決まった作業はスクリプトがやる。Claude は案内・判断・説明・問題の切り分けをする。**

| 道具                            | やること                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `node kit/doctor.mjs`           | どこまで済んだかを確かめ、「次にやること」を出す。**各段階の終わりと、迷ったときは必ずこれを実行する** |
| `node kit/render-config.mjs`    | `kit/site.json` を検証し、本番の Worker の設定を作る（`npm run deploy` が先に呼ぶ）                    |
| `node kit/cloudflare-setup.mjs` | Cloudflare 側の資源を作る（既定は計画だけ、`--apply` で作る。何度実行してもよい）                      |
| `mac/scripts/*.sh`              | Mac の基礎設定（`pmset-setup.sh`、`check.sh`、VM の `vm-guest-stage1〜3.sh`）                          |

約束：

1. `CLAUDE.md` の「守ること」は導入でも同じ。特に **秘密情報（パスワード、API トークン、サービストークンの Secret、Tunnel のトークン、Slack Webhook URL、SwitchBot の token/secret）を導入者にチャットへ貼らせない。** 誤って貼られたら、その値を作り直すよう伝える。
2. **API トークンが要るコマンド（`cloudflare-setup.mjs`、`CLOUDFLARE_API_TOKEN` を付けた `doctor.mjs`）は、導入者が自分のターミナルで実行する。** Claude はコマンドを示し、出力（秘密は含まれない）を見せてもらって判断する。Claude の環境にトークンを入れない。
3. sudo、システム設定の画面操作、ブラウザでのログインは導入者がやる。コマンドは 1 つずつ、期待される結果と一緒に示す。
4. 取り消しにくい操作（`--apply`、`npm run deploy`、FileVault オフ、ユーザー作成）は実行前に確認を取る。
5. 手順と実機が食い違ったら推測で埋めない。`doctor.mjs` の出力や画面を見せてもらって確かめ、確かめた結果は `docs/verify.md` の各項目の「結果：」に書く。
6. リポジトリのファイルを導入先の値で書き換えない（値は `kit/site.json` だけ）。

詳しい手順と背景は `docs/initial-setup.md`（実機で確定した版）、`cloudflare/*/setup.md`（Cloudflare を手で作る場合）、`docs/runbook.md`（壊れたとき）、`kit/lessons.md`（はまりどころ）。これらの文書は見本の値（利用者 Taro / Hanako / Jiro、example.com）で書いてあるので、導入先の値に読み替える。

## 1. 前提の確認と聞き取り

導入者に次を確かめる。足りないものがあれば、そこで止めて用意してもらう。

| 項目                                                                           | 必須 | 確かめ方・補足                                                                                               |
| ------------------------------------------------------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------ |
| Apple Silicon の Mac（VM 2 台ならメモリ 24GB 以上・SSD 空き 200GB 以上を推奨） | ○    | `sysctl -n hw.memsize`、`df -h /`                                                                            |
| この Mac を Claude 専用にしてよいか                                            | ○    | FileVault オフ・自動ログイン・スリープ無効にする（`docs/spec.md` 13章）。日常使いの Mac には入れない方がよい |
| macOS のユーザー名がオーナーのメールの @ より前と同じ                          | ○    | `whoami`。違うとブラウザ版 SSH に入れない                                                                    |
| Cloudflare アカウントと、DNS を Cloudflare に置いた独自ドメイン                | ○    | 無料プランで足りる                                                                                           |
| ログインに使うメールアドレス（使う人の分）                                     | ○    | 最初はメールに届く番号（ワンタイム PIN）でログインする。Google ログインはあとから足せる                      |
| Claude のアカウント（使う環境の分。Remote Control が使えるプラン）             | ○    | 1 人で全部使ってもよい                                                                                       |
| Slack の Incoming Webhook                                                      | 任意 | 無ければ通知なしで動く                                                                                       |
| SwitchBot プラグミニ                                                           | 任意 | 電源の入れ直し用                                                                                             |

**VM の台数は 0〜2 台**（host は必須。macOS の使用許諾で、1 台の Mac で動かせる macOS の VM は 2 つまで）。VM を使わないなら Tart も要らない。1 台なら vm1 にする。

聞き取ったら `kit/site.example.json` を `kit/site.json` にコピーして埋める（秘密情報は入らない）。

| キー                      | 意味                                                                                | 例                                   |
| ------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------ |
| `org_name` / `org_footer` | 画面・ガイドに出る組織名 / フッター                                                 | `Example` / `Example Inc.`           |
| `domain`                  | Cloudflare に置いたドメイン（SSH / VNC は `ssh-host.<domain>` など）                | `example.com`                        |
| `dashboard_host`          | ダッシュボードのホスト名（`domain` の 1 階層下）                                    | `workstation.example.com`            |
| `access_team`             | Zero Trust のチーム名（3 章で決める名前と同じにする）                               | `example`                            |
| `timezone`                | 表示用タイムゾーン                                                                  | `Asia/Tokyo`                         |
| `people.host / vm1 / vm2` | 表示名・macOS のユーザー名・ログインのメール。host は必須、vm1 / vm2 は使う VM だけ | `Taro` / `taro` / `taro@example.com` |
| `viewers`                 | 閲覧だけの人のメール                                                                | `[]`                                 |
| `cloudflare.*`            | 3 章のスクリプトが埋める（手で書かない）                                            |                                      |

## 2. リポジトリを置く

```bash
mkdir -p ~/workspace && cd ~/workspace
git clone https://github.com/BridgeUI/agentstation.git
cd agentstation && npm ci
cp kit/site.example.json kit/site.json   # 1 章の値を書く
node kit/doctor.mjs
```

- 置き場所は `~/workspace/agentstation` に固定（launchd のラッパーと Remote Control の作業フォルダがこのパスを前提にしている）。
- `kit/site.json` は `.gitignore` 済み。秘密ではないが導入先の構成そのものなので、導入者の private な場所にも控えてもらう。
- 確認：`doctor.mjs` の「2. 導入先の値」が ✓（「まだ空の値」は 3 章で埋まる）。

## 3. Cloudflare

### 3.1 画面で 2 つだけ（導入者）

1. **Zero Trust のチーム**：Cloudflare のダッシュボード › Zero Trust を初めて開くとチーム名を決める画面になる。名前を `site.json` の `access_team` と同じにする（プランは Free）。
2. **API トークン**：My Profile › API Tokens › Create Token › Custom token。権限は `kit/cloudflare-setup.mjs` の先頭に書いてある（Account の Access 3 種・Cloudflare Tunnel・D1 を Edit、対象ゾーンの DNS を Edit）。値は導入者のパスワードマネージャーに控える。

### 3.2 スクリプトで作る（導入者のターミナルで）

```bash
cd ~/workspace/agentstation
read -rs CLOUDFLARE_API_TOKEN && export CLOUDFLARE_API_TOKEN   # 貼り付けても画面に出ない
node kit/cloudflare-setup.mjs           # 計画（何を作るか）を見る
node kit/cloudflare-setup.mjs --apply   # 作る
```

- 作るもの：D1、ログイン方法（ワンタイム PIN）、Access のアプリとポリシー（ダッシュボード、エージェント API、使う環境ごとの SSH・VNC）、サービストークン、Tunnel と DNS、内部ネットワークのルート。
- 秘密（サービストークンの Secret、Tunnel のトークン）は `~/.config/agentstation/cloudflare/`（chmod 600）にだけ書かれる。SSH の CA の公開鍵も同じ場所の `ca/`。
- 秘密でない値（アカウント ID、D1 の ID、AUD、Client ID）は `kit/site.json` の `cloudflare` に書き戻される。出力に出る `AGENT_TOKEN_NAMES にする値` を 4 章で使う。
- サービストークンの Secret は作ったときにしか取れない。ファイルを無くしたら Cloudflare の画面でそのトークンを消して、もう一度 `--apply`。
- 確認：`CLOUDFLARE_API_TOKEN=… node kit/doctor.mjs` の「3. Cloudflare」が ✓。

任意（あとでよい）：Google でログインしたい → `cloudflare/access/setup.md` 1 章。WARP 経由の SSH・VNC・ファイル共有 → `cloudflare/warp/setup.md`。

## 4. Worker（ダッシュボード）

```bash
cd ~/workspace/agentstation/worker
npx wrangler login
npm run db:migrate:remote
npm run build:ui && npm run deploy      # 先にデプロイ（Worker ができてから secret を入れる）
echo '<3.2 で出た AGENT_TOKEN_NAMES にする値>' | npx wrangler secret put AGENT_TOKEN_NAMES -c wrangler.deploy.toml
npx wrangler secret put VNC_PASSWORDS_JSON -c wrangler.deploy.toml   # 導入者が入力。6 章で決めてからでもよい
npx wrangler secret put SLACK_WEBHOOK_URL -c wrangler.deploy.toml    # 任意。導入者が入力
```

- `AGENT_TOKEN_NAMES` の値（Client ID）は秘密ではないので Claude が実行してよい。`VNC_PASSWORDS_JSON` と `SLACK_WEBHOOK_URL` は導入者が入力する。
- 確認：`node kit/doctor.mjs` の「4. ダッシュボード」が ✓。ブラウザで `https://<dashboard_host>/` を開き、メールに届く番号でログインでき、使う環境が「未報告」で並ぶ。

## 5. host（Mac 本体）

`docs/initial-setup.md` 4 章に沿う（見本の `taro` は導入者のユーザー名に読み替える）。スクリプトになっていない手作業が多いので、1 つずつ進める。

1. システム設定（導入者）：自動ログイン、FileVault オフ、リモートログインと画面共有（VNC パスワード）、ターミナルに Full Disk Access（4.1）
2. `sudo bash mac/scripts/pmset-setup.sh` と自動更新の停止（4.2）
3. ツール：Homebrew、Node、Tart（VM を使うときだけ）、cloudflared、Claude Code（4.3）。`claude auth login`（4.4）
4. **cloudflared**（導入者。sudo）：`sudo cloudflared service install "$(cat ~/.config/agentstation/cloudflare/tunnel-token)"`。3.2 で Cloudflare 側に設定を持つ Tunnel を作ったので、`/etc/cloudflared/config.yml` は要らない（4.7 の手順は手で Tunnel を作った場合）
5. **エージェント**：`mv ~/.config/agentstation/cloudflare/token.host.json ~/.config/agentstation/token.json`。`config.json` を作る（4.5。`base_url` は `https://<dashboard_host>`、`vms` は使う VM、VM なしなら `"vms": []`）。`npm run build --workspace agent`
6. launchd（4.6）、sudoers・newsyslog・sshd（4.8。sshd の CA は `~/.config/agentstation/cloudflare/ca/ssh-host.pub` を `/etc/ssh/ca.pub` に）
7. 確認：`bash mac/scripts/check.sh` と `node kit/doctor.mjs` の「5. この Mac」が ✓。ダッシュボードの host が「正常」、基礎設定が全部 OK

`kit/lessons.md` の「エージェントの再起動でこのセッションが切れる」に注意（host の Remote Control 越しに導入しているとき）。

## 6. VM（使う台数だけ。0 台なら飛ばす）

`docs/initial-setup.md` 5 章：`tart clone` → 構築用の鍵 → `vm-guest-stage1.sh`〜`stage3.sh`（stage2 には `BASE_URL=https://<dashboard_host>` を渡す）。トークンは `~/.config/agentstation/cloudflare/token.<vm>.json` を VM の `~/.config/agentstation/token.json` に置き、host 側のファイルは消す。sshd の CA は `ca/ssh-<vm>.pub`。IP は vm1 = `192.168.64.10`、vm2 = `192.168.64.11`。

確認：VM の中で `node kit/doctor.mjs`、ダッシュボードでその VM が「正常」。

## 7. 利用者の初期設定と確認

- `docs/onboarding.md` を各利用者に渡す（画面版はダッシュボードの「使い方ガイド」）。要点は、画面共有で入る → 設定アシスタントを閉じる → `claude auth login`。
- `docs/initial-setup.md` 8 章のチェックリスト、再起動・電源断からの復帰試験（`docs/runbook.md` 8 章）。

## 8. 仕上げ

- `docs/initial-setup.md` 9 章の「構築後に残る作業」を導入先の状況で見直し、残りを導入者に伝える。
- 導入先の決めごと（通知先チャンネル、スマートプラグの有無など）を導入者に控えてもらう。
- `kit/site.json` を導入者の private な場所に控えてもらう。

## 9. 上流の更新を取り込む

```bash
cd ~/workspace/agentstation
git pull && npm ci
npm run typecheck && npm test --workspaces --if-present
cd worker && npm run db:migrate:remote && npm run build:ui && npm run deploy
```

そのあと各マシンで `git pull`（VM は host から rsync）→ `npm ci && npm run build --workspace agent` → `launchctl kickstart -k gui/$(id -u)/co.bridgeui.agentstation.agent`（`kit/lessons.md` の注意を先に読む）→ `node kit/doctor.mjs`。

導入先でリポジトリのファイルを直さない（次の `git pull` でぶつかる）。直したいところは上流に issue か PR を出す。

## 困ったとき

1. `node kit/doctor.mjs` の「次にやること」から当たる。
2. 症状から：`docs/runbook.md` の早見表。
3. Cloudflare の資源がおかしい：`node kit/cloudflare-setup.mjs`（計画）で、何が足りないかを見る。
