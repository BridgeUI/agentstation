# 実装タスク

フェーズ順に進める。各フェーズの「完了条件」を満たしてから次へ。実機（Mac mini）での作業は、手順と期待結果を書いて利用者（Taro）に依頼する。

設計判断は `docs/spec.md` 13章で確定済み（2026-10-31）。構成は Worker 1 つ＋D1、エージェントは host・vm1・vm2 の 3 か所、通知は Slack。

---

## フェーズ0：リポジトリの土台

- [x] `CLAUDE.md` の構成どおりにディレクトリを作る（`worker/`、`db/`、`agent/`、`mac/`、`cloudflare/`、`docs/`、`shared/`）
- [x] `.gitignore`（`.env*`、`*.pem`、鍵類、`node_modules`、`.wrangler`、`.DS_Store`）
- [x] TypeScript の共通設定、lint/format（`tsconfig.base.json`、eslint、prettier）
- [x] `db/schema.sql`（`docs/spec.md` 4.2 のたたき台から。インデックス含む）とマイグレーション
- [x] ペイロードとAPIの型を `shared/` にまとめ、worker / agent で共有
- [x] `MEMBERS_JSON` の型と検証（起動時に形を確認して失敗させる）
- [x] `worker/wrangler.toml`：静的アセット、D1 バインディング、Cron Trigger（`* * * * *`）、カスタムドメイン、`workers.dev` 無効（`database_id` と Access の値は Taro が埋める）

**完了条件**：`wrangler d1` でローカルにスキーマが作れる。型チェックが通る。`wrangler dev` で静的ページと API が同じ Worker から返る。→ 2026-10-31 達成（Node v24 を nodebrew で導入、wrangler 4.156）

## フェーズ1：実機での事前確認（利用者に依頼）

`docs/spec.md` 11章の未確認事項のうち、設計を左右するものを先に確かめる。確認手順書を `docs/verify.md` に書き、結果を同じファイルに記録してもらう。

Mac本体
- [x] 実機のCPUコア数、メモリ、ディスク、macOS のバージョン（12 コア / 24GB / 460GB / macOS 27.2）
- [x] FileVault をオフにする（`fdesetup disable`。決定済み）。`fdesetup status` が Off になること
- [ ] `pmset -g` の現状。設定後に 24 時間スリープしないこと（`pmset -g log | grep -i sleep`）
- [x] 自動ログインが有効にできるか（FileVault オフ後）
- [ ] スマートプラグ（SwitchBot プラグミニ）の設置。ダッシュボードの「電源を入れ直す」（またはアプリからオフ→オン）で Mac が自動起動し、ログインまで進むこと

Tart
- [x] VM 作成・`--no-graphics` 起動・`tart ip` の安定性。ゲスト内静的IP（.10 / .11）に決定。`tart ip` は `--resolver arp` か config の `vm_ips`
- [x] VMごとの仮想化プロセスの特定方法（lsof で disk.img から）
- [x] ゲスト内の自動ログイン（kcpassword 直書き）・`pmset`・ソフトウェア更新オフ・画面共有（VNC パスワード方式）
- [x] `192.168.64.1` でホストの sshd に届くか
- [x] VM 内から `workstation.example.com` へ HTTPS が通ること（エージェントを VM に置くため）

Claude
- [x] `claude remote-control` を launchd から起動できるか（信頼と y/n の同意を一度対話で）
- [x] 停止→再起動でセッションが戻るか、`--session-id` とタイトルの取り方（ログの [bridge:*] 行）
- [x] `--debug-file` のログに出る接続成功・失敗の文言、「作業中」の判定材料
- [ ] 各アカウントのプランで Remote Control が使えるか

Cloudflare・Slack
- [x] example.com の DNS が Cloudflare にあるか
- [x] Google を Access の IdP に登録できるか（Google Workspace 側の管理権限）
- [ ] example の Slack で Incoming Webhook を作れるか。通知先チャンネルを決める

**完了条件**：`docs/verify.md` に結果が揃い、設計の変更点があれば `docs/spec.md` に反映済み。

## フェーズ2：Mac側の常駐設定

- [x] `mac/launchd/` に plist テンプレート：`cloudflared`（LaunchDaemon）、エージェント（host 用と VM 用）、`tart run vm1/vm2`、`claude remote-control`（環境ごと）。絶対パス・`HOME`・`LANG`・`ThrottleInterval` 入り
- [x] 各環境の `~/.claude/settings.json` 用の断片（`DISABLE_AUTOUPDATER=1`、`autoUpdatesChannel: "stable"`）
- [x] `mac/sudoers.d/` に `shutdown -r` だけ許可する断片（host のみ）
- [x] `mac/newsyslog.d/` にログローテーション設定
- [x] `mac/sshd/` に `TrustedUserCAKeys` 用の断片（Access の SSH CA）
- [x] 導入手順書 `docs/setup-mac.md`：自動ログイン、FileVault オフ、`pmset`（スリープ無効・停電後起動・Power Nap オフ）、macOS/App Store/Homebrew の自動更新オフ、有線 LAN と DHCP 予約、タイムゾーン、SSH/画面共有オン、ユーザー名をメールの @ 前に合わせる、Time Machine/Spotlight から `~/.tart` を除外、HDMI ダミープラグ（任意）、サービストークン（環境ごと）の置き場と更新手順、エージェントの更新手順（`git pull`＋`launchctl kickstart`）、「ログアウトしない」の注意。VM ゲスト用の同じチェックリスト

**完了条件**：手順書どおりに入れて再起動（とスマートプラグでの電源断→復帰）すると、人手なしで3環境の Remote Control がスマホから見える。`pmset -g` が手順書の値と一致する。

## フェーズ3：Worker の API と D1

- [x] API：`/api/agent/heartbeat`（`peers` の返却含む）、`/api/agent/result`、`/api/me`、`/api/status`、`/api/commands`、`/api/commands/:id/cancel`、`/api/audit`、`/api/sessions`
- [x] Access JWT の検証（`Cf-Access-Jwt-Assertion`、`aud`/`iss`/`exp`、JWKS キャッシュ）とロール判定（オーナー／本人／閲覧者）
- [x] エージェント用はサービストークン（環境ごと 3 本）で保護。`common_name` と報告の `env` の一致を確認
- [x] `commands` の状態遷移、`executor` の決定、二重実行防止、環境ごとの同時実行 1 件、`expires_at`、`not_before`（ホスト再起動の猶予）、取り消し
- [x] すべての操作を `audit_log` に記録
- [x] `sessions` のタイトルは 60 文字に切り、`heartbeats` / `heartbeat_history` には保存しない
- [x] `Cache-Control: no-store`、JSON 必須、閲覧者への 403
- [x] テスト：ロールごとに許可・拒否されること、二重実行されないこと、取り消しが `queued` のときだけ効くこと、vm1 のトークンで host を名乗れないこと、閲覧者が `/api/sessions` を呼べないこと（`worker/test/`、21件）

**完了条件**：ローカル（wrangler）で 3 環境分の模擬エージェントと画面の操作が一通り通る。→ 2026-10-31 達成（vitest＋@cloudflare/vitest-plugin で D1 ごと検証）

## フェーズ4：エージェント

- [x] `--env host|vm1|vm2` で役割を切り替える構成（`docs/spec.md` 3.6 の表）
- [x] 状態収集：自分の環境の Claude/Codex/Remote Control、セッション。host はさらに VM の 4 状態、使用量（host本体＝全体−VM分）、付帯情報
- [x] 60秒ごとのハートビート、指示の受け取り、ホワイトリスト操作の実行、結果送信。Cloudflare 不達時は次回に回す
- [x] `vm_stop`/`vm_start` の `launchctl disable/enable` 実装、`host_restart` の「done を送ってから shutdown」
- [x] 夜間メンテナンスのスケジューラ（JST）。VM 側は作業中判定＋更新、host 側は `peers` を見て VM 再起動
- [x] 送るデータに秘密情報・ファイル名・パスを含めないことのテスト（送信直前のフィルタ。タイトルは 60 文字で切る）

**完了条件**：実機で 3 か所に入れて動かし、ダッシュボードに3環境の状態が出て、`rc_restart`（vm1 内で実行）と `vm_restart`（host で実行）が動く。

## フェーズ5：ダッシュボード画面

- [x] `design/` のモックをもとに5画面を実装（一覧、3人の環境、接続ガイド）
- [x] `/api/status` の値で描画（サンプル値は使わない）。30 秒ごとに取り直す。時刻は JST
- [x] `/api/me` のロールでボタン・セクションを出し分け（判定はサーバー側が本体）。閲覧者には接続・ログイン情報・操作を出さない
- [x] 実行中の指示の表示、取り消しボタン、ホスト再起動の 2 段階確認と猶予カウントダウン
- [x] 「要確認（エージェント停止）」「起動中」の表示
- [x] 各環境ページに「基礎設定」セクション（手動設定の未完了を先頭に。shared/src/setup.ts）
- [x] 「説明」ボタンの開閉、スマホ幅での崩れなし、ボタンは44px以上

**完了条件**：実データで5画面が表示され、閲覧者には操作が出ない。→ 2026-10-31 ローカルの seed データで確認済み。実データでの確認は実機のエージェント稼働後

## フェーズ6：Cron と Slack 通知

- [x] Cron（1分）で途絶判定（host と VM エージェントを分けて）、復旧通知、重複抑制
- [x] `docs/spec.md` 4.3 の条件（VM停止、要ログイン、再接続待ち、ディスク、メモリ、操作の失敗・期限切れ、夜間メンテナンスの失敗）
- [x] 期限切れ指示の `expired` 化、`running` 放置の `failed` 化
- [x] 保持期間を過ぎた行の削除（`sessions` 含む）
- [x] Slack Incoming Webhook は `wrangler secret`。本文に秘密情報・タイトルを入れない。ダッシュボードへのリンクを付ける

**完了条件**：host のエージェントを止めると10分以内に Slack に通知が来て、戻すと復旧通知が来る。vm1 のエージェントだけ止めると vm1 だけの通知になる。

## フェーズ7：Tunnel・Access・WARP

- [x] `cloudflare/` に cloudflared 設定テンプレート（6ホスト名＋内部ネットワーク `192.168.64.0/24`）
- [x] Access の設定手順（手順書）：Google を IdP に登録、アプリ（ダッシュボード、`/api/agent` の Service Auth、SSH×3、VNC×3）、ブラウザ表示、ポリシー、セッション時間
- [x] WARP＋Access for Infrastructure の設定手順（手順書）（Split Tunnel で `192.168.64.0/24` を通す、ターゲット、Gateway で 5900 を許可）、VMの内部IP固定
- [x] `workers.dev` の無効化（wrangler.toml）。カスタムドメインの確認は初回デプロイ時

**完了条件**：A（ブラウザ）とB（WARP＋アプリ）の両方で、3環境にSSH・画面共有できる。iPhone からも確認する。

## フェーズ8：夜間メンテナンスと復旧

- [ ] 毎晩（04:00〜04:40、`docs/spec.md` 7章の表）：VM 側の作業中判定と更新 → host 側の VM 再起動 → host 自身の更新と RC 再起動 → 接続確認 → 失敗時は1回立て直し → 通知
- [x] ログ監視による自動の立て直し（1 時間に 3 回まで）→ 2026-10-31 23:57 に host で実際に発動（err.log「再接続待ちが続くため Remote Control を立て直す」→ 立て直し ok）
- [x] ホスト再起動の2段階確認と取り消し（実機で通す）→ 2026-11-01 取り消しまで実機で確認（実行は未実施。runbook 8 章）
- [x] スマートプラグでの電源断→自動復帰の手順書（`docs/spec.md` 6.1。ディスク破損リスク、ルーター停止時は使えないことを明記）→ runbook 5 章
- [x] スマートプラグのダッシュボード連携（2026-11-01 オーナーの決定。spec 6.1・13章 #22）：Worker の SwitchBot クライアント、`host_power_cycle`（executor `cloud`、オーナー・2 段階・host 途絶時のみ）、Cron でのオフ→オンと状態取得、`plug_status`、画面の表示と操作、Slack（オフ・届かない・応答なしの切り分け）、テスト 11 件 → 実機での確認は spec 11章の SwitchBot の項（`power` / `weight` / 署名 / 通電時の状態）
- [ ] 復旧訓練：電源断→復帰、host のエージェント停止、VM のエージェント停止、ログアウト、の 4 通りを実際にやって `docs/runbook.md` に記録 → 2026-11-01 VM のエージェント停止・ログアウト（vm2）・VM 再起動・Codex 再起動は実施済み。残りは電源断（スマートプラグ待ち）と host 側

**完了条件**：手動で Claude を更新・再起動しても、数分以内に Remote Control とセッションが戻る。電源断からも人手なしで戻る。
