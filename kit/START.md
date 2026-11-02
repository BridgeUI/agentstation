# 導入の進め方（Claude Code 向け）

このファイルは、このリポジトリを **別の人が自分の Mac と Cloudflare アカウントで立ち上げる** ときに、Claude Code が上から順に従う手順。導入する人（以下「導入者」。host を使うオーナー）と対話しながら進める。

実機で確認済みの構成（`docs/initial-setup.md`）をそのまま作る。設計を変える作業ではない。

## 0. 最初に読むもの・守ること

1. `CLAUDE.md`（守ること 1〜6 は導入でも同じ。特に「秘密情報を画面・D1・ログ・**チャット**に出さない」）
2. このファイル
3. `docs/initial-setup.md`（実機で確定した手順。**この文書の章立てに沿って進める**）
4. 必要になったら `cloudflare/*/setup.md`、`docs/setup-mac.md`、`docs/runbook.md`、`kit/lessons.md`

進め方の約束：

- 1 段階ずつ進め、各段階の「済んだかの確認」を導入者と一緒に確かめてから次へ。
- **秘密情報（パスワード、サービストークンの Secret、Tunnel の認証情報、Slack Webhook URL、SwitchBot の token/secret、API トークン）を導入者にチャットへ貼らせない。** `wrangler secret put` の対話入力、chmod 600 のファイル、キーチェーンに直接入れてもらう。誤って貼られたら、その値を作り直すよう伝える。
- sudo が要るコマンド、システム設定の画面操作、ブラウザでのログインは導入者にやってもらう。コマンドは 1 つずつ、期待される結果と一緒に示す。
- 取り消しにくい操作（FileVault オフ、DNS レコード作成、`wrangler deploy`、ユーザー作成）は実行前に確認を取る。
- 手順と実機が食い違ったら推測で埋めず、導入者に画面やコマンド出力を見せてもらって確かめる。確かめた結果は `docs/verify.md` の各項目の「結果：」に書く。

### 文書の読み替え

`docs/` と `cloudflare/` の文書、コードのコメント、`worker/wrangler.toml` では、見本の値（利用者 Taro / Hanako / Jiro、ドメイン example.com）を使っている。導入先の値は `kit/site.json` に書き、リポジトリのファイルは書き換えない（画面は Worker の設定 `SITE_JSON` から名前などを出す）。文書を読むときは次のとおり読み替える。

| 文書の表記            | 導入先では                                                      |
| --------------------- | --------------------------------------------------------------- |
| Taro                  | オーナー（host を使う導入者。`kit/site.json` の `people.host`） |
| Hanako                | vm1 を使う人（`people.vm1`）                                    |
| Jiro                  | vm2 を使う人（`people.vm2`）                                    |
| example.com / example | `site.json` の `domain` / `access_team`（または `org_name`）    |

## 1. 前提の確認と聞き取り

導入者に次を確かめる。足りないものがあれば、そこで止めて用意してもらう。

| 項目                                                                                              | 必須 | 確かめ方・補足                                                                                                   |
| ------------------------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------- |
| Apple Silicon の Mac（VM 2 台ならメモリ 24GB 以上推奨・SSD 空き 200GB 以上。VM なしなら制限なし） | ○    | `sysctl -n hw.memsize`、`df -h /`。VM 2 台に 6GB ずつ割り当てる（`docs/initial-setup.md` 5.1）                   |
| この Mac を Claude 専用にしてよいか                                                               | ○    | FileVault オフ・自動ログイン・スリープ無効にする（`docs/spec.md` 13章）。日常使いの Mac なら導入しない方がよい   |
| macOS のユーザー名がオーナーのメールの @ より前と同じ                                             | ○    | `whoami`。違うとブラウザ版 SSH に入れない。違えば新しいユーザーを作るか、`site.json` の login とメールを合わせる |
| 有線 LAN（推奨）とルーターの DHCP 予約                                                            | △    | Wi-Fi でも動くが復旧が不安定                                                                                     |
| Cloudflare アカウントと、DNS を Cloudflare に置いた独自ドメイン                                   | ○    | ダッシュボードで対象ゾーンが Active。無料プランで足りる                                                          |
| Cloudflare Zero Trust（無料プラン）とチーム名                                                     | ○    | Zero Trust を初めて開くとチーム名を決める画面になる。50 人まで無料                                               |
| ログイン用の Google アカウント（3 人分）                                                          | ○    | Gmail でも可。Google Cloud で OAuth クライアントを作る（同意画面は **外部** にする。`kit/lessons.md`）           |
| Claude のアカウント 3 つ（Remote Control が使えるプラン）                                         | ○    | 各環境で別アカウント。プランは導入者が確認                                                                       |
| Slack の Incoming Webhook                                                                         | 任意 | 無ければ通知なしで動く（あとから足せる）                                                                         |
| SwitchBot プラグミニ                                                                              | 任意 | 電源の入れ直し用。無ければプラグの表示が出ないだけ                                                               |
| Node.js 22 以上、Homebrew                                                                         | ○    | 無ければ 4 章で入れる                                                                                            |

VM の台数：**0〜2 台から選べる**（host は必須）。macOS の使用許諾で、1 台の Mac で動かせる macOS の VM は 2 つまで。VM を使わないなら Mac 本体（host）だけの導入になり、Tart も要らない。1 台だけなら vm1 か vm2 のどちらか（名前は URL に出るだけなので、ふつうは vm1）。

使わない VM について、手順で省くもの：

- `site.json` の `people` にその VM を書かない
- サービストークン、SSH と VNC の Access アプリ、DNS、cloudflared の ingress、WARP のターゲットを作らない
- `AGENT_TOKEN_NAMES` と `VNC_PASSWORDS_JSON` に書かない
- host のエージェントの `config.json` の `vms` に入れない（VM なしなら `"vms": []`。`tart_path` も要らない）
- `mac/launchd/co.bridgeui.agentstation.tart-<vm>.plist` を置かない
- 6 章をその VM の分だけ飛ばす

聞き取ったら `kit/site.example.json` を `kit/site.json` にコピーして埋める（秘密情報は入らない）。

| キー                      | 意味                                                                                              | 例                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `org_name` / `org_footer` | 画面・ガイドに出る組織名 / フッター                                                               | `Example` / `Example Inc.`           |
| `domain`                  | Cloudflare に置いたドメイン                                                                       | `example.com`                        |
| `dashboard_host`          | ダッシュボードのホスト名（`domain` の 1 階層下）                                                  | `workstation.example.com`            |
| `access_team`             | Zero Trust のチーム名                                                                             | `example`                            |
| `timezone`                | 表示用タイムゾーン                                                                                | `Asia/Tokyo`                         |
| `people.host / vm1 / vm2` | 表示名・macOS ユーザー名・Google ログインのメール。host は必須、vm1 / vm2 は使う VM だけ書く      | `Taro` / `taro` / `taro@example.com` |
| `viewers`                 | 閲覧だけの人のメール                                                                              | `[]`                                 |
| `cloudflare.*`            | D1 の ID、Access の AUD タグ 2 つ、SwitchBot の deviceId（3〜4 章で分かったら書く。秘密ではない） |                                      |

SSH / VNC のホスト名は `ssh-host.<domain>`、`vnc-vm1.<domain>` のように自動で決まる。

## 2. リポジトリを置く

置き場所は **`~/workspace/agentstation`** に固定（launchd のラッパーと Remote Control の作業フォルダ `~/workspace` がこのパスを前提にしている）。

リポジトリのファイルは書き換えない。導入先の値は `kit/site.json` だけに書き、デプロイのときに `kit/render-config.mjs` がそこから本番の Worker の設定（`worker/wrangler.deploy.toml`）を作る。どちらも `.gitignore` 済みでリポジトリには入らない。`kit/site.json` は秘密ではないが導入先の構成そのものなので、導入者のパスワードマネージャーや private な場所にも控えてもらう（無くすと作り直しになる）。

```bash
mkdir -p ~/workspace && cd ~/workspace
git clone https://github.com/BridgeUI/agentstation.git   # 既に clone 済みなら不要
cd agentstation
npm ci
cp kit/site.example.json kit/site.json   # 1 章で聞き取った値を書く
node kit/render-config.mjs --check       # 形の確認（D1 の ID などはまだ空でよい）
```

- `worker/public/logo.png` は見本のロゴ。導入者のロゴに差し替える場合は、上流の更新（9 章）で戻らないよう、差し替えたことを導入者に伝えておく（今は差し替えの仕組みが無い。TODO：ロゴも設定で持つ）。
- ガイドの画面写真（`worker/public/guide/*.jpg`）は見本データのもの。名前などは写っているが、導入先で撮り直さなくても使える。

## 3. Cloudflare（`docs/initial-setup.md` 2 章、`cloudflare/access/setup.md`、`cloudflare/cloudflared/setup.md`）

導入者がブラウザで操作する。Claude in Chrome などブラウザを操作できる道具があれば、導入者の了承を得て使ってよい（ログインと秘密情報の表示画面は導入者が操作）。

1. Zero Trust のチーム名を `site.json` の `access_team` と揃える。
2. Google の IdP：Google Cloud にプロジェクトを作り、同意画面は **外部**、公開ステータスは本番、スコープは openid / email / profile。OAuth クライアントの Client ID / Secret は Zero Trust の画面に直接貼る（チャットに貼らない）。
3. Access アプリ（Self-hosted）：ダッシュボード（`dashboard_host`）と、エージェント API（`dashboard_host/api/agent`、Service Auth）。それぞれの **AUD タグ** を `kit/site.json` の `cloudflare.access_aud_dashboard` / `access_aud_agent` に書く（AUD は秘密ではない）。
4. サービストークン 3 本（host / vm1 / vm2）。Secret は表示されたその場で各マシンの `~/.config/agentstation/token.json`（chmod 600）に入れる。VM 用は host の一時ファイルに置いて 5 章で配る。**Client ID**（トークン名ではない）を `AGENT_TOKEN_NAMES` に使う。
5. SSH / VNC の Access アプリ 6 つと SSH CA。CA 公開鍵を `cloudflare/access/ca/` に置き直す（`README.md` の表と同じ名前で）。
6. Tunnel（`cloudflared tunnel create agentstation`）、DNS 6 本、内部ネットワーク `192.168.64.0/24`、ingress は `cloudflare/cloudflared/config.yml.example`。
7. WARP（経路 B）は任意。後回しにしてよい（`cloudflare/warp/setup.md`）。

確認：`https://<dashboard_host>/` を開くと Google ログインに飛ぶ（Worker はまだ無いのでログイン後はエラーでよい）。

## 4. Worker と D1（`docs/initial-setup.md` 3 章、`cloudflare/worker/setup.md`）

```bash
cd ~/workspace/agentstation/worker
npx wrangler login
npx wrangler d1 create agentstation        # 出力の database_id を kit/site.json の cloudflare.d1_database_id に書く
npm run db:migrate:remote                  # kit/site.json から本番の設定を作ってマイグレーション
npx wrangler secret put AGENT_TOKEN_NAMES  # {"host":"<Client ID>","vm1":"…"}（使う環境の分だけ）
npx wrangler secret put VNC_PASSWORDS_JSON # 6 章で VNC パスワードを決めてからでもよい
npx wrangler secret put SLACK_WEBHOOK_URL  # 任意
npm run build:ui && npm run deploy         # kit/site.json から本番の設定を作ってデプロイ
```

- `npm run deploy` と `npm run db:migrate:remote` は、先に `kit/render-config.mjs` を実行する。D1 の ID と AUD タグ 2 つが `kit/site.json` に無ければ止まって知らせる。
- 確認：ダッシュボードに Google でログインでき、使う環境が「未報告」で並ぶ。名前・ドメインが `site.json` の値になっている。`/api/health` が 200。

## 5. host（`docs/initial-setup.md` 4 章）

4.1〜4.9 をそのまま。要点：

- システム設定での手作業（自動ログイン、FileVault オフ、画面共有・リモートログイン、Full Disk Access）は導入者が行う。
- `mac/scripts/pmset-setup.sh`、Homebrew・Node・Tart・cloudflared・Claude Code の導入、`claude auth login` と初回の同意（対話）。
- エージェントの `~/.config/agentstation/config.json` は `agent/src/config.ts` 冒頭のコメントの形。`base_url` は `https://<dashboard_host>`。
- launchd：`mac/launchd/co.bridgeui.agentstation.*.plist` の `__USER__` / `__ENV__` を置換して配置（`mac/launchd/README.md`）。ラベルは導入先によらず固定。
- `mac/scripts/check.sh` で抜けを確認。ダッシュボードの host の「基礎設定」が全部 OK になること。

`kit/lessons.md` の「エージェントの再起動でこのセッションが切れる」に注意（host で Claude Code を動かしながら導入しているとき）。

## 6. VM（使う台数だけ。0 台なら飛ばす。`docs/initial-setup.md` 5 章）

`tart clone` → 構築用の鍵 → `mac/scripts/vm-guest-stage1.sh`〜`stage3.sh`（stage2 には `BASE_URL=https://<dashboard_host>` を渡す）。利用者のパスワードと VNC パスワードは host の `~/.config/agentstation/vm1-secrets` などに置き、本人には安全な経路で伝える。IP は vm1 = `192.168.64.10`、vm2 = `192.168.64.11`（Tart の既定のネットワーク。変えると cloudflared・ガイド・エージェントの設定も変える必要がある）。

## 7. 利用者の初期設定と確認

- `docs/onboarding.md` を各利用者に渡す（画面版はダッシュボードの「使い方ガイド」）。
- `docs/initial-setup.md` 8 章のチェックリストを全部確かめる。
- 再起動・電源断からの復帰試験（`docs/runbook.md` 8 章）。

## 8. 仕上げ

- ガイドの画面写真を撮り直す：`worker/scripts/guide-shots.mjs`（ダッシュボードに実データが出てから）。
- `docs/initial-setup.md` 9 章の「構築後に残る作業」を導入先の状況で見直し、残りを導入者に伝える。
- 導入先の決めごと（通知先チャンネル、スマートプラグの有無など）を `docs/runbook.md` 9 章に書く。
- `kit/site.json` を導入者の private な場所に控えてもらう。

## 9. 上流の更新を取り込む

```bash
cd ~/workspace/agentstation
git pull
npm ci
npm run typecheck && npm test --workspaces --if-present
cd worker && npm run db:migrate:remote && npm run build:ui && npm run deploy
```

そのあと各マシン（host と VM）で `git pull`（VM は host から rsync）→ `npm ci && npm run build --workspace agent` → エージェントの再起動（`launchctl kickstart -k gui/$(id -u)/co.bridgeui.agentstation.agent`。`kit/lessons.md` の注意を先に読む）。

リポジトリのファイルを導入先で直さない（次の `git pull` でぶつかる）。直したいところは上流に issue か PR を出す。
