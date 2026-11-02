# 導入の進め方（Claude Code 向け）

このファイルは、このリポジトリを **別の人が自分の Mac mini と Cloudflare アカウントで立ち上げる** ときに、Claude Code が上から順に従う手順。導入する人（以下「導入者」。host を使うオーナー）と対話しながら進める。

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

`docs/` と `cloudflare/` の文書、コードのコメントでは、利用者を見本の名前で書いている。`personalize.mjs` は画面・ガイド・スクリプトの名前を置き換えるが、文書の中の名前はそのまま残るので、次のとおり読み替える。

| 文書の表記            | 導入先では                                                      |
| --------------------- | --------------------------------------------------------------- |
| Taro                  | オーナー（host を使う導入者。`kit/site.json` の `people.host`） |
| Hanako                | vm1 を使う人（`people.vm1`）                                    |
| Jiro                  | vm2 を使う人（`people.vm2`）                                    |
| example.com / example | `site.json` の `domain` / `access_team`（または `org_name`）    |

## 1. 前提の確認と聞き取り

導入者に次を確かめる。足りないものがあれば、そこで止めて用意してもらう。

| 項目                                                                   | 必須 | 確かめ方・補足                                                                                                   |
| ---------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------- |
| Apple Silicon の Mac mini（メモリ 24GB 以上推奨、SSD 空き 200GB 以上） | ○    | `sysctl -n hw.memsize`、`df -h /`。VM 2 台に 6GB ずつ割り当てる（`docs/initial-setup.md` 5.1）                   |
| この Mac を Claude 専用にしてよいか                                    | ○    | FileVault オフ・自動ログイン・スリープ無効にする（`docs/spec.md` 13章）。日常使いの Mac なら導入しない方がよい   |
| macOS のユーザー名がオーナーのメールの @ より前と同じ                  | ○    | `whoami`。違うとブラウザ版 SSH に入れない。違えば新しいユーザーを作るか、`site.json` の login とメールを合わせる |
| 有線 LAN（推奨）とルーターの DHCP 予約                                 | △    | Wi-Fi でも動くが復旧が不安定                                                                                     |
| Cloudflare アカウントと、DNS を Cloudflare に置いた独自ドメイン        | ○    | ダッシュボードで対象ゾーンが Active。無料プランで足りる                                                          |
| Cloudflare Zero Trust（無料プラン）とチーム名                          | ○    | Zero Trust を初めて開くとチーム名を決める画面になる。50 人まで無料                                               |
| ログイン用の Google アカウント（3 人分）                               | ○    | Gmail でも可。Google Cloud で OAuth クライアントを作る（同意画面は **外部** にする。`kit/lessons.md`）           |
| Claude のアカウント 3 つ（Remote Control が使えるプラン）              | ○    | 各環境で別アカウント。プランは導入者が確認                                                                       |
| Slack の Incoming Webhook                                              | 任意 | 無ければ通知なしで動く（あとから足せる）                                                                         |
| SwitchBot プラグミニ                                                   | 任意 | 電源の入れ直し用。無ければプラグの表示が出ないだけ                                                               |
| Node.js 22 以上、Homebrew                                              | ○    | 無ければ 4 章で入れる                                                                                            |

使う人が 3 人いないとき：環境は host・vm1・vm2 の 3 つで固定（コードの前提）。vm1 / vm2 の `email` にオーナーのメールを入れておけば、オーナーが全部を使える。VM を作らないと、その環境は「途絶」のままになり通知が出続けるので、VM は 2 台とも作る。

聞き取ったら `kit/site.example.json` を `kit/site.json` にコピーして埋める（秘密情報は入らない）。

| キー                      | 意味                                              | 例                                   |
| ------------------------- | ------------------------------------------------- | ------------------------------------ |
| `org_name` / `org_footer` | 画面・ガイドに出る組織名 / フッター               | `Example` / `Example Inc.`           |
| `domain`                  | Cloudflare に置いたドメイン                       | `example.com`                        |
| `dashboard_host`          | ダッシュボードのホスト名（`domain` の 1 階層下）  | `workstation.example.com`            |
| `access_team`             | Zero Trust のチーム名                             | `example`                            |
| `label_prefix`            | launchd のラベルの接頭辞（逆ドメイン）            | `com.example`                        |
| `timezone`                | 表示用タイムゾーン                                | `Asia/Tokyo`                         |
| `people.host / vm1 / vm2` | 表示名・macOS ユーザー名・Google ログインのメール | `Taro` / `taro` / `taro@example.com` |
| `viewers`                 | 閲覧だけの人のメール                              | `[]`                                 |

SSH / VNC のホスト名は `ssh-host.<domain>`、`vnc-vm1.<domain>` のように自動で決まる。

## 2. リポジトリを導入先用にする

置き場所は **`~/workspace/macmini-dashboard`** に固定（launchd のラッパーと Remote Control の作業フォルダ `~/workspace` がこのパスを前提にしている）。

ブランチの考え方：OSS の `main` には見本の値（example.com、Taro など）が入っている。導入先の値を当てたものは **`deploy` ブランチ** に 1 コミットで持つ。上流の更新は `kit/update.sh` で `deploy` を作り直して取り込む（9 章）。`deploy` はメールアドレスや構成が入るので、置くなら導入者の **private リポジトリ**（GitHub の public な fork にはしない）。

```bash
mkdir -p ~/workspace && cd ~/workspace
git clone https://github.com/BridgeUI/macmini-dashboard.git   # 既に clone 済みなら不要
cd macmini-dashboard
git remote rename origin upstream
git checkout -b deploy
npm ci
node kit/personalize.mjs kit/site.json --dry-run   # 変わるファイルの一覧を導入者に見せる
node kit/personalize.mjs kit/site.json
npm run build:ui --workspace worker
npm run typecheck && npm test --workspaces --if-present
git add -A && git add -f kit/site.json && git commit -m "導入先の値を適用"
```

- テストが全部通ることを確かめる。通らなければ `git diff` を見て原因を直す。
- 最後に出る「元の値が残っている行」はコードのコメントか利用者に見える文言。見える文言なら手で直す（直したものは `site.json` で表せないので、上流に PR で直すのが本筋）。
- `worker/public/logo.png` は見本のロゴ。導入者のロゴ（横長でも可、高さ 30px 程度で表示される PNG）に差し替えてよい。
- `worker/public/guide/*.jpg` は見本データの画面写真。導入が終わってから撮り直してよい（8 章）。
- 導入者の private リポジトリがあれば `git remote add origin <URL> && git push -u origin deploy`。

## 3. Cloudflare（`docs/initial-setup.md` 2 章、`cloudflare/access/setup.md`、`cloudflare/cloudflared/setup.md`）

導入者がブラウザで操作する。Claude in Chrome などブラウザを操作できる道具があれば、導入者の了承を得て使ってよい（ログインと秘密情報の表示画面は導入者が操作）。

1. Zero Trust のチーム名を `site.json` の `access_team` と揃える。
2. Google の IdP：Google Cloud にプロジェクトを作り、同意画面は **外部**、公開ステータスは本番、スコープは openid / email / profile。OAuth クライアントの Client ID / Secret は Zero Trust の画面に直接貼る（チャットに貼らない）。
3. Access アプリ（Self-hosted）：ダッシュボード（`dashboard_host`）と、エージェント API（`dashboard_host/api/agent`、Service Auth）。それぞれの **AUD タグ** を `kit/site.json` の `cloudflare.access_aud_dashboard` / `access_aud_agent` に書く（AUD は秘密ではない。4 章で `wrangler.toml` に反映する）。
4. サービストークン 3 本（host / vm1 / vm2）。Secret は表示されたその場で各マシンの `~/.config/macmini-agent/token.json`（chmod 600）に入れる。VM 用は host の一時ファイルに置いて 5 章で配る。**Client ID**（トークン名ではない）を `AGENT_TOKEN_NAMES` に使う。
5. SSH / VNC の Access アプリ 6 つと SSH CA。CA 公開鍵を `cloudflare/access/ca/` に置き直す（`README.md` の表と同じ名前で）。
6. Tunnel（`cloudflared tunnel create macmini`）、DNS 6 本、内部ネットワーク `192.168.64.0/24`、ingress は `cloudflare/cloudflared/config.yml.example`。
7. WARP（経路 B）は任意。後回しにしてよい（`cloudflare/warp/setup.md`）。

確認：`https://<dashboard_host>/` を開くと Google ログインに飛ぶ（Worker はまだ無いのでログイン後はエラーでよい）。

## 4. Worker と D1（`docs/initial-setup.md` 3 章、`cloudflare/worker/setup.md`）

```bash
cd ~/workspace/macmini-dashboard/worker
npx wrangler login
npx wrangler d1 create macmini-dashboard        # 出力の database_id を site.json の cloudflare.d1_database_id に書く
npx wrangler d1 migrations apply macmini-dashboard --remote
npx wrangler secret put AGENT_TOKEN_NAMES       # {"host":"<Client ID>","vm1":"…","vm2":"…"}
npx wrangler secret put VNC_PASSWORDS_JSON      # 5 章で VNC パスワードを決めてからでもよい
npx wrangler secret put SLACK_WEBHOOK_URL       # 任意
npm run build:ui && npx wrangler deploy
```

- D1 の ID と AUD タグ 2 つは `kit/site.json` の `cloudflare` に書き、`node kit/personalize.mjs kit/site.json` をもう一度実行して `wrangler.toml` に入れる（`wrangler.toml` を直接直すと、9 章の更新のたびに消える）。`grep REPLACE_WITH worker/wrangler.toml` で何も出ないことを確かめてからデプロイし、`deploy` にコミットする。
- 確認：ダッシュボードに Google でログインでき、3 環境が「未報告」で並ぶ。`/api/health` が 200。

## 5. host（`docs/initial-setup.md` 4 章）

4.1〜4.9 をそのまま。要点：

- システム設定での手作業（自動ログイン、FileVault オフ、画面共有・リモートログイン、Full Disk Access）は導入者が行う。
- `mac/scripts/pmset-setup.sh`、Homebrew・Node・Tart・cloudflared・Claude Code の導入、`claude auth login` と初回の同意（対話）。
- エージェントの `~/.config/macmini-agent/config.json` は `agent/src/config.ts` 冒頭のコメントの形。`base_url` は `https://<dashboard_host>`。
- launchd：`mac/launchd/<label_prefix>.*.plist` の `__USER__` / `__ENV__` を置換して配置（`mac/launchd/README.md`）。
- `mac/scripts/check.sh` で抜けを確認。ダッシュボードの host の「基礎設定」が全部 OK になること。

`kit/lessons.md` の「エージェントの再起動でこのセッションが切れる」に注意（host で Claude Code を動かしながら導入しているとき）。

## 6. VM 2 台（`docs/initial-setup.md` 5 章）

`tart clone` → 構築用の鍵 → `mac/scripts/vm-guest-stage1.sh`〜`stage3.sh`。利用者のパスワードと VNC パスワードは host の `~/.config/macmini-agent/vm1-secrets` などに置き、本人には安全な経路で伝える。IP は vm1 = `192.168.64.10`、vm2 = `192.168.64.11`（Tart の既定のネットワーク。変えると cloudflared・ガイド・エージェントの設定も変える必要がある）。

## 7. 利用者の初期設定と確認

- `docs/onboarding.md` を各利用者に渡す（画面版はダッシュボードの「使い方ガイド」）。
- `docs/initial-setup.md` 8 章のチェックリストを全部確かめる。
- 再起動・電源断からの復帰試験（`docs/runbook.md` 8 章）。

## 8. 仕上げ

- ガイドの画面写真を撮り直す：`worker/scripts/guide-shots.mjs`（ダッシュボードに実データが出てから）。
- `docs/initial-setup.md` 9 章の「構築後に残る作業」を導入先の状況で見直し、残りを導入者に伝える。
- 導入先の決めごと（通知先チャンネル、スマートプラグの有無など）を `docs/runbook.md` 9 章に書く。
- 変更を `deploy` にコミットする（private リポジトリへ push）。

## 9. 上流の更新を取り込む

```bash
cd ~/workspace/macmini-dashboard
git checkout deploy
bash kit/update.sh     # upstream/main から deploy を作り直し、site.json を当て、テストまで通してコミット
```

そのあと、スクリプトが最後に出す手順（D1 のマイグレーション、`wrangler deploy`、private リポジトリへの push、各マシンでの `git reset --hard origin/deploy`・エージェントのビルドと再起動）を導入者と順に行う。`deploy` は毎回作り直すので、各マシンでは `git pull` ではなく `git fetch` ＋ `git reset --hard` で揃える。

`deploy` で直接コードを直さない（次の更新で消える）。直したいところは上流に issue か PR を出す。
