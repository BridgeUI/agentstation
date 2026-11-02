# 仕様：Mac mini 3環境 監視・操作ダッシュボード

元の設計書（人間向け）：
この文書はそれを実装向けに整理し、検討漏れを補ったもの。設計判断の経緯は 13章にまとめる（2026-10-31 に Taro が全項目を決定済み。元の設計書にも反映済み）。

---

## 1. 目的と要件

| 要件         | 内容                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------- |
| 常駐         | 3環境それぞれで `claude remote-control`（と可能ならCodex）が動き続ける。再起動後も自動で復帰 |
| 状況確認     | 各環境の生死、Claude/Codex/Remote Controlの状態、CPU・メモリ・ディスク、リソース配分を見る   |
| 障害検知     | Macや回線が落ちてもダッシュボードは動き続け、「応答なし」を表示・Slack通知                   |
| リモート操作 | Remote Controlの立て直し、Claude更新、セッション復元、VM再起動など。ホスト再起動は例外扱い   |
| 接続         | SSH・画面共有をボタン1つで。ブラウザだけでも、WARP＋アプリでも入れる                         |
| 共有         | 閲覧者は見るだけ。操作と接続は本人（とオーナー）                                             |

---

## 2. 全体構成

```
[利用者のブラウザ/スマホ]
      │ ログイン（Cloudflare Access・Google）
      ▼
[Worker: workstation.example.com] ── 静的UI ＋ API ＋ Cron（1分ごと） ◄──► [D1]
      ▲                                   │
      │ HTTPS（外向き、60秒ごと）          └──► Slack（example の Slack、Incoming Webhook）
      │
[Mac mini: host] ── エージェント（host）、claude remote-control、Codex、cloudflared（Tunnel）
      ├─ Tart: vm1（Hanako）── エージェント（vm1）、claude remote-control、Codex
      └─ Tart: vm2（Jiro）  ── エージェント（vm2）、claude remote-control、Codex
```

- Cloudflare 側は **Worker 1 つ**（静的アセット＋API＋Cron Trigger）＋ D1。wrangler 設定と D1 バインディングが 1 つで済む。
- エージェントは **同じプログラムを host・vm1・vm2 の 3 か所に置く**（`--env` で役割が変わる）。VM 内のエージェントは NAT 越しに Cloudflare へ直接報告する。ホスト→VM の SSH 鍵は不要。
- 原則：Mac → Cloudflare の外向き接続だけ。報告が途切れること自体を障害の合図にする。
- 時刻の扱い：D1 と API は unix ミリ秒（UTC）。画面表示は JST（Asia/Tokyo）。Cron は UTC で動くが、夜間メンテナンスは Mac 側のエージェントが JST で実行する。

---

## 3. Mac側

### 3.1 環境と常駐プロセス

| 環境      | 常駐させるもの                                                                                         | 種別                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| host      | `cloudflared`（Tunnel）                                                                                | **LaunchDaemon**（root、ログイン前から動く。GUIセッションが壊れても SSH の経路を残す）       |
| host      | エージェント（host）、`claude remote-control`、Codex、VM 2台の起動（`tart run --no-graphics vm1/vm2`） | LaunchAgent（Taro のGUIセッション。Tart と Claude のキーチェーンはユーザーセッションが必要） |
| vm1 / vm2 | エージェント（vm1 / vm2）、`claude remote-control`、Codex、SSH（リモートログイン）、画面共有           | ゲスト内の LaunchAgent（ゲストも自動ログイン）                                               |

- `claude remote-control` は各環境の LaunchAgent。`KeepAlive` で落ちたら同じ作業フォルダで再起動。`ThrottleInterval` は 30 秒程度にして再起動ループを緩める。
- plist では `PATH` が引き継がれないので、`claude`・`tart`・`node` は絶対パスで書く。`HOME`、`LANG`（`ja_JP.UTF-8` または `en_US.UTF-8`）も明示する。
- 作業フォルダはホーム直下にしない（信頼設定が保存されず、端末なし起動で `Workspace not trusted` で止まる）。`~/Desktop`・`~/Documents` も使わない（iCloud の「デスクトップと書類」同期が有効だと場所が変わる）。作業フォルダの信頼と Remote Control の初回同意はエージェントが起動時に記録する（13章 #23）。
- `--no-create-session-in-dir` は使わない（停止時にセッションがアーカイブされ、復元できなくなる）。
- 起動順：電源投入 → `cloudflared`（Daemon）→ 自動ログイン → エージェント（host）→ VM 起動 → ホストの Remote Control。VM 内は、ゲストの自動ログイン → エージェント（vm）→ ゲストの Remote Control。VM の起動完了まで 1〜2 分かかるので、その間は「起動中」として扱う。
- **GUIセッションからログアウトしない**（LaunchAgent がすべて止まる）。画面共有で入ったときも「ログアウト」は押さない。再起動が必要なときは `host_restart` を使う。
- 各環境の Claude は別アカウント（A/B/C）。Codex CLI も各環境で別の ChatGPT アカウント。3 アカウントは用途分離のためで、上限回避の使い回しはしない。
- 各環境には他の環境の鍵や認証情報を置かない。エージェントのサービストークンも環境ごとに別にする（3.6）。

### 3.2 Mac本体の基礎設定（host。VMのゲストにも同じ設定を入れる）

**電源・スリープ**（無人運用の生命線。手順書 `docs/setup-mac.md` に `pmset` と画面の両方を書く）

| 設定                                   | 値                                                                               | 方法                                                                                                                                                                                                                                                              |
| -------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| システムのスリープ                     | 無効                                                                             | `sudo pmset -a sleep 0`。システム設定 › エネルギー ›「ディスプレイがオフのときに自動でスリープさせない」をオン                                                                                                                                                    |
| ディスクのスリープ                     | 無効                                                                             | `sudo pmset -a disksleep 0`                                                                                                                                                                                                                                       |
| ディスプレイのスリープ                 | 許可してよい（ヘッドレスなので影響なし）                                         | `sudo pmset -a displaysleep 10`                                                                                                                                                                                                                                   |
| 自動的に起動                           | **常に**（`autorestartatconnect 1`。2026-11-01 変更）                            | `sudo pmset -a autorestartatconnect 1`。システム設定 › エネルギー › 自動的に起動：常に。「停電後」（`autorestart 1`）は電源が切れる前に動いていたときだけ戻るので、意図してシャットダウンしたあとにスマートプラグで電源を入れ直しても起動しない（オーナーの指摘） |
| Power Nap                              | オフ                                                                             | `sudo pmset -a powernap 0`                                                                                                                                                                                                                                        |
| ネットワークアクセスによるスリープ解除 | オン（害はない）                                                                 | `sudo pmset -a womp 1`                                                                                                                                                                                                                                            |
| 確認                                   | `pmset -g` と `pmset -g assertions` で値を確認し、結果を `docs/verify.md` に貼る |                                                                                                                                                                                                                                                                   |

- VM のゲスト macOS にも `sudo pmset -a sleep 0 disksleep 0` を入れる（ゲストがアイドルでスリープすると SSH も Remote Control も止まる）。
- スクリーンセーバ後のパスワード要求は**オンのまま**でよい（launchd には影響しない。物理アクセス対策）。画面共有で入ると鍵画面が出るので、その環境のパスワードを入れる。
- 画面共有の画質・解像度のために HDMI ダミープラグを挿すことを推奨（任意。ディスプレイなしだと解像度が低く固定される場合がある）。

**ログイン・暗号化**

| 設定               | 値                                                       | 理由                                                                                                                                        |
| ------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 自動ログイン       | オン（host は Taro、VM 内は各本人）                      | 電源断からの無人復帰に必須。キーチェーンが解錠され Claude の認証情報が読める                                                                |
| FileVault          | **オフ**（2026-10-31 決定）                              | Apple Silicon では FileVault が有効だと自動ログインが使えない。オンのままだと電源断後に誰かが実機でパスワードを入れるまで何も立ち上がらない |
| ユーザー名         | Access のメールの @ より前（`taro` / `hanako` / `jiro`） | ブラウザ版 SSH・VNC がこの一致を要求する                                                                                                    |
| ログインパスワード | 強いものにする。画面共有・鍵画面で使う                   | FileVault を切る分、ここが最後の砦                                                                                                          |

**自動更新（勝手な再起動を防ぐ）**

- macOS：システム設定 › 一般 › ソフトウェアアップデート › 自動アップデートで「macOS アップデートをインストール」をオフ。`sudo softwareupdate --schedule off`。更新は Taro が計画的に行う。
- App Store の自動更新もオフ。Homebrew の自動更新（`HOMEBREW_NO_AUTO_UPDATE=1`）もオフ。
- Claude Code の自動更新はオフ（7章）。Tart・cloudflared は夜間メンテナンスで更新しない（手動）。

**ネットワーク**

- 有線 LAN を使う（Wi‑Fi は復帰が不安定）。ルーターで Mac mini の LAN IP を固定（DHCP 予約）。
- 受信ポートは一切開けない。macOS ファイアウォールはオンのままでよい（すべて外向き）。
- 時刻同期はオン（Access の JWT 検証とログの突き合わせに効く）。タイムゾーンは Asia/Tokyo。
- ファイル共有（SMB）で利用者の `~/workspace` を共有名 `workspace` で公開し、iPhone の「ファイル」アプリから WARP 経由で開けるようにする（`cloudflare/warp/setup.md` 6-5、`mac/scripts/smb-workspace.sh`）。ゲスト不可。基礎設定 `sharing.smb_workspace` で「445 が開いている・`workspace` の共有がある（ゲスト不可）・利用者に SMB-NT ハッシュがある」を見張り、接続タブの「ファイルアプリ」の行に共有中／未準備を出す（2026-11-01）。

**ディスク・ログ**

- Tart の VM イメージ（`~/.tart/vms/`）を Time Machine（`tmutil addexclusion`）と Spotlight の対象から外す。
- `--debug-file` のログ、エージェントのログ、cloudflared のログは `newsyslog.d` でローテーションする（上限 50MB × 5 世代程度）。
- ディスク空きが 15% を切ったら警告、10% で異常（5章）。

**バックアップ**

- Mac 本体のバックアップは本プロジェクトの対象外（決定）。作業内容は各環境で git に push する運用にする。

### 3.3 リソース配分（M4 10コアを想定。実機で要確認）

| 環境             | CPU          | メモリ         | ディスク |
| ---------------- | ------------ | -------------- | -------- |
| host（Taro本体） | 全コアを共有 | 約12GB（残り） | 約230GB  |
| vm1（Hanako）    | 4コア        | 6GB            | 90GB     |
| vm2（Jiro）      | 4コア        | 6GB            | 90GB     |
| 空けておく分     | ー           | ー             | 約100GB  |

- VMのCPUは専有ではない。VMのメモリは上限値で、使った分だけ本体から消費し、VM再起動まで戻らない見込み。
- 配分変更はVMを止めてから（`tart set`）。
- 共有のWindows環境は置かない（メモリ不足のため）。
- VM のディスクイメージはスパースで、割り当て（90GB）と実使用（`du`）が違う。画面には両方を出す。

### 3.4 VMのネットワークとIP

- Tart の既定は NAT（`192.168.64.0/24`、ゲートウェイ＝ホストの `192.168.64.1`）。VM の MAC アドレスは固定なので、macOS の DHCP は通常同じ IP を返すが保証はない。
- **VM の IP は固定する（決定）**。方法は実機で検証して決める：(a) ゲスト内で `192.168.64.x` を静的設定、(b) `--net-bridged` でルーターの DHCP 予約。固定するので cloudflared の設定書き換え機能は作らない。
- WARP 経由（8.2 の B）で使う「内部IP」は、host も VM も `192.168.64.0/24` に揃える（host は `192.168.64.1`）。家庭の LAN（`192.168.1.0/24` など）とメンバー宅の LAN が衝突するのを避けるため。`192.168.64.1` でホストの sshd に届くかは要確認。
- cloudflared は**ローカル設定ファイル**（`config.yml`）で動かす（設定をリポジトリで管理できる）。内部ネットワーク（WARP 経由）は `cloudflared tunnel route ip add 192.168.64.0/24 <tunnel>` で有効になる。`warp-routing` キーは 2023.9 以降の cloudflared では不要（書くと警告）。再起動が必要なときは Taro が SSH で `sudo launchctl kickstart -k system/com.cloudflare.cloudflared`。エージェントは cloudflared を触らない。

### 3.5 VMのライフサイクル

- `tart run` の LaunchAgent は `KeepAlive: true`。`vm_restart` は `tart stop` → launchd が再起動。
- `vm_stop` は `launchctl disable gui/<uid>/<label>` → `launchctl bootout` → `tart stop`。`disable` は再起動後も残るので「自動起動も止まる」。`vm_start` は `launchctl enable` → `launchctl bootstrap`。
- VM の状態は `tart list` の値に「起動中（IP未取得／エージェント未報告）」を加えた 4 値：`stopped` / `starting` / `running` / `unknown`。

### 3.6 エージェントの責務（host と各VMで同じプログラム。`--env host|vm1|vm2` で役割が変わる）

| 役割                                                | host のエージェント                                                                                                                      | vm1 / vm2 のエージェント                                                               |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 自分の環境の Claude / Codex / Remote Control の状態 | ○                                                                                                                                        | ○                                                                                      |
| セッションIDの記録                                  | ○                                                                                                                                        | ○                                                                                      |
| 使用量                                              | ホスト全体のCPU・メモリ・ディスク、VMごとの仮想化プロセスのCPU・メモリ、Tartのディスクイメージ容量。**host本体の値＝全体−VM 2台分**      | ゲスト内のディスク使用量だけ（CPU・メモリは host 側の値を使う）                        |
| VM の状態（`tart list` / `tart ip`）                | ○                                                                                                                                        | ー                                                                                     |
| 付帯情報                                            | macOS のバージョン、稼働時間、起動時刻、Tart のバージョン、エージェント自身の起動時刻                                                    | ゲストの macOS バージョン、起動時刻、エージェントの起動時刻                            |
| 実行する指示                                        | `rc_restart` / `session_restore` / `claude_update` / `codex_restart`（host 向け）、`vm_restart` / `vm_stop` / `vm_start`、`host_restart` | `rc_restart` / `session_restore` / `claude_update` / `codex_restart`（自分の環境向け） |
| 夜間メンテナンス                                    | host の Claude 更新と RC 再起動。VM の再起動（7章）                                                                                      | 自分の環境の作業中判定と Claude 更新（7章）                                            |

1. 60秒ごとに状態を集め、`POST /api/agent/heartbeat` で送る。応答で未実行の指示（自分が実行すべきもの）と、host の場合は VM 側の直近の報告（`peers`）を受け取る。Cloudflare に届かないときはそのまま次回に回す（溜めない）。
   - 応答の `poll_ms` が短い（5 秒）あいだは、その間隔で `POST /api/agent/poll`（状態は送らず、指示と次の間隔だけ受け取る軽い問い合わせ）を呼ぶ。サーバーは「直近 90 秒に画面が見られた（`/api/status` が呼ばれた）」か「そのエージェント宛の指示が queued / running」なら 5 秒、それ以外は 60 秒を返す。フルの報告は 60 秒ごとのまま。指示を実行し終えた直後は報告を前倒しし、その後 60 秒は毎回フルの報告にする（「起動中 → 稼働中」を早く見せる）。2026-11-01 オーナーの指示「最低 1 分、アクティブな時は 5 秒」
2. Remote Control の状態はログ（`--debug-file`）とプロセスから判定（接続中／再接続待ち／要ログイン）。
3. ホワイトリストの操作だけを実行し、`POST /api/agent/result` で結果を返す。同じ環境では同時に 1 件しか実行しない。
4. 夜間メンテナンス（7章）を JST で実行する。
5. ログのローテーションと、送るデータに秘密情報を含めないことの自己チェック（パス・メール・トークンらしき文字列をはじく）。
6. サービストークンは環境ごとに別（3 本）。Access が発行する JWT の `common_name` には**トークンの Client ID** が入る（トークン名ではない）。サーバーは Client ID → 環境の対応表（secret `AGENT_TOKEN_NAMES`）で環境を決め、報告の `env` と一致することを確認する（vm1 のエージェントが host を名乗れない）。VM が乗っ取られても、そのトークンだけ Delete すればよい。

---

## 4. Cloudflare側

### 4.1 API（Worker）

| エンドポイント                  | 呼ぶ側                | 認証                               | 役割                                                                                                |
| ------------------------------- | --------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| `POST /api/agent/heartbeat`     | エージェント（3環境） | Accessサービストークン（環境ごと） | 状態を保存し、未実行の指示を返す。host には `peers`（VM エージェントの直近の報告の要約）も返す      |
| `POST /api/agent/result`        | エージェント          | Accessサービストークン             | 実行結果を保存                                                                                      |
| `POST /api/agent/poll`          | エージェント          | Accessサービストークン             | 軽い問い合わせ。状態は保存せず、未実行の指示と次の間隔 `poll_ms` だけ返す（3.6）                    |
| `GET /api/me`                   | 画面                  | Access JWT                         | 自分のメールとロール、操作できる環境（ボタンの出し分け用）                                          |
| `GET /api/status`               | 画面                  | Access JWT                         | 全環境の最新状態・最終受信時刻・配分・実行中の指示                                                  |
| `POST /api/commands`            | 画面                  | Access JWT＋ロール判定             | 操作指示を登録（権限がなければ403）                                                                 |
| `POST /api/commands/:id/cancel` | 画面                  | Access JWT＋本人/オーナー          | `queued` の指示を取り消す（ホスト再起動の猶予中の取り消しもこれ）                                   |
| `GET /api/audit`                | 画面                  | Access JWT                         | 操作履歴                                                                                            |
| `GET /api/sessions?env=`        | 画面                  | Access JWT＋本人/オーナー          | 記録済みセッション（復元用）                                                                        |
| `POST /api/notify/test`         | 画面                  | Access JWT＋オーナー               | Slack にテスト通知を送る（Webhook 登録後の確認用。未登録なら 503。送ったことを `audit_log` に残す） |

- `/api/agent/*` は Access の別アプリ（パス指定）で「Service Auth」ポリシーだけを許可し、人は呼べないようにする。Worker 側でも JWT を検証し、`common_name`（＝サービストークンの Client ID）がどの環境のトークンかを確認する。
- 画面向けの API は `Cache-Control: no-store`。画面は表示中 5 秒ごとに `/api/status` を取り直す（非表示のタブは 60 秒）。`/api/status` が呼ばれると `activity` テーブルに「見られた時刻」を残し（isolate ごとに 20 秒に 1 回）、エージェントの間隔を速める判断に使う。
- JWT 検証：`aud`（アプリの Audience タグ）、`iss`（チームドメイン）、`exp` を確認。公開鍵（JWKS）は 1 時間キャッシュ。
- POST は `Content-Type: application/json` 必須（CSRF 対策の一つ）。
- 指示の実行者：`vm_restart` / `vm_stop` / `vm_start` / `host_restart` は host のエージェントに、`host_power_cycle` は Worker 自身（`executor = 'cloud'`。Cron が SwitchBot のクラウド API を呼ぶ。6.1）に、それ以外はその環境のエージェントに渡す（`commands.executor`）。`cloud` の指示はエージェントの heartbeat / poll には返さない。

### 4.2 D1 テーブル（たたき台）

```sql
-- 環境ごとの最新状態（1行を上書き。host の行には VM の状態・使用量も入る）
CREATE TABLE heartbeats (
  env TEXT PRIMARY KEY,            -- 'host' | 'vm1' | 'vm2'
  received_at INTEGER NOT NULL,    -- unixミリ秒（サーバー受信時刻）
  payload TEXT NOT NULL            -- エージェントが送ったJSON（秘密情報を含めない。sessions は除く）
);
-- 7日分の履歴（5分に1回だけ保存。古いものは Cron が削除。sessions は含めない）
CREATE TABLE heartbeat_history (
  env TEXT NOT NULL, received_at INTEGER NOT NULL, payload TEXT NOT NULL,
  PRIMARY KEY (env, received_at)
);
CREATE INDEX idx_hh_received ON heartbeat_history(received_at);
CREATE TABLE commands (
  id TEXT PRIMARY KEY,             -- UUID（二重実行防止のキー）
  env TEXT NOT NULL,               -- 対象の環境
  executor TEXT NOT NULL,          -- 実行するエージェント（'host' | 'vm1' | 'vm2'）
  action TEXT NOT NULL,            -- ホワイトリストのみ
  args TEXT,                       -- JSON（session_id など）
  status TEXT NOT NULL,            -- queued | running | done | failed | expired | canceled
  requested_by TEXT NOT NULL,      -- メール
  created_at INTEGER NOT NULL,
  not_before INTEGER,              -- ホスト再起動の取り消し猶予
  expires_at INTEGER NOT NULL,     -- これを過ぎて queued のままなら expired
  started_at INTEGER,
  finished_at INTEGER,
  output TEXT                      -- 結果の要約（秘密情報・パスを含めない）
);
CREATE INDEX idx_commands_executor_status ON commands(executor, status);
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL, actor_email TEXT NOT NULL, action TEXT NOT NULL,
  target TEXT, detail TEXT
);
-- 復元用のセッション一覧。本人とオーナーにだけ返す（9章）
CREATE TABLE sessions (
  env TEXT NOT NULL, session_id TEXT NOT NULL,
  title TEXT,                      -- 先頭60文字まで。履歴には残さない
  started_at INTEGER, last_seen INTEGER NOT NULL,
  PRIMARY KEY (env, session_id)
);
CREATE TABLE notify_state (
  key TEXT PRIMARY KEY, state TEXT, updated_at INTEGER
);
-- スマートプラグの直近の状態（Cron が 1 分ごとに上書き。6.1）。token・機器 ID は入れない
CREATE TABLE plug_status (
  key TEXT PRIMARY KEY,            -- 'host'
  checked_at INTEGER NOT NULL,
  ok INTEGER NOT NULL,             -- 1: 応答が読めた / 0: 届かない・エラー
  state TEXT NOT NULL,             -- 'on' | 'off' | 'unknown'
  watts REAL,                      -- 現在の消費電力（W）
  error TEXT                       -- 失敗の要約（秘密を含めない）
);
```

- メンバーとロールはテーブルにせず、環境変数 `MEMBERS_JSON` で持つ：`{"owner":"taro@example.com","envs":{"host":"taro@…","vm1":"…","vm2":"…"},"viewers":["…"]}`。Access で許可されていてこの一覧に無い人は閲覧者。
- 保持期間：`heartbeat_history` 7日、`commands` 90日、`audit_log` 1年、`sessions` は `last_seen` から 7 日。Cron が削除する。

### 4.3 Cron Trigger（同じ Worker、1分ごと）と Slack 通知

通知先は example の Slack（Incoming Webhook。チャンネルは Taro が決める）。Webhook URL は `wrangler secret`。

| 条件                                                                     | 通知                                                                           | 復旧通知             |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | -------------------- |
| host の最終受信が 10 分以上前（エージェント・ホスト・回線のどれか）      | 「Mac mini 応答なし」                                                          | あり（停止時間つき） |
| VM のエージェントだけ 10 分以上前（host は VM を running と報告）        | 「vm1 のエージェントが応答なし」                                               | あり                 |
| ある環境の VM が `stopped` のまま 5 分以上（`vm_stop` による停止は除く） | 「vm1 が停止」                                                                 | あり                 |
| Remote Control が「要ログイン」                                          | 「vm1 は再ログインが必要」                                                     | あり                 |
| Remote Control が「再接続待ち」のまま 15 分以上                          | 「vm1 の Remote Control がつながらない」                                       | あり                 |
| ディスク使用率 85% 以上（警告）／90% 以上（異常）                        | 「ディスクが残り少ない」                                                       | あり                 |
| メモリ使用率 90% 以上が 10 分継続                                        | 「メモリ逼迫」                                                                 | あり                 |
| 指示が `failed`                                                          | 「操作が失敗」（誰が何を）                                                     | なし                 |
| 指示が `expired`                                                         | 「操作が期限切れ」                                                             | なし                 |
| 夜間メンテナンスの失敗                                                   | 「vm1 の夜間メンテナンスが失敗」                                               | なし                 |
| スマートプラグがオフのまま 2 分以上（`host_power_cycle` の実行中は除く） | 「スマートプラグがオフ（Mac mini に電源が来ていない）」                        | あり                 |
| host は報告しているのにスマートプラグに 15 分以上届かない                | 「スマートプラグに届かない（Mac は動いている）」。最後の復旧手段が使えない状態 | あり                 |

- 「Mac mini 応答なし」の本文には、プラグの様子を 1 行添える（届かない → 回線かルーター、オンで消費電力がほぼ 0 → Mac が落ちている、オンで通電あり → エージェントか macOS の問題）。プラグが未設定なら何も添えない。

- 同じ障害を繰り返し通知しない（`notify_state` に状態を持つ）。Slack の本文には環境名・状態・時刻・ダッシュボードへのリンクだけを入れ、ログやパスは入れない。
- `queued` のまま `expires_at` を過ぎた指示を `expired` に、`running` のまま 30 分過ぎた指示を `failed` にする。
- 保持期間を過ぎた行を削除する（4.2）。

### 4.4 ハートビートのペイロード（たたき台）

vm1 のエージェント：

```json
{
  "env": "vm1",
  "agent_version": "0.1.0",
  "agent_started_at": 1793400000000,
  "sent_at": 1793447367000,
  "guest": {
    "os_version": "26.1",
    "boot_at": 1793300000000,
    "disk_used_gb": 41,
    "disk_total_gb": 90
  },
  "claude": {
    "state": "running",
    "rc_state": "connected",
    "version": "x.y.z",
    "channel": "stable",
    "last_restart": 1793400000000
  },
  "codex": { "state": "running" },
  "sessions": [{ "id": "…", "title": "…（先頭60文字）", "started_at": 1793440000000 }],
  "maintenance": { "last_run_at": 1793390400000, "last_result": "updated" }
}
```

host のエージェント：

```json
{
  "env": "host",
  "agent_version": "0.1.0",
  "agent_started_at": 1793400000000,
  "sent_at": 1793447367000,
  "host": {
    "os_version": "26.1",
    "tart_version": "2.x",
    "boot_at": 1793300000000,
    "cpu_cores": 10,
    "mem_total_gb": 24,
    "disk_total_gb": 512,
    "cpu_pct": 38,
    "mem_used_gb": 14.2,
    "disk_used_gb": 210
  },
  "claude": { "…": "host 自身の Claude（vm1 と同じ形）" },
  "codex": { "state": "running" },
  "sessions": [],
  "vms": [
    {
      "env": "vm1",
      "vm_state": "running",
      "ip": "192.168.64.x",
      "usage": { "cpu_pct_of_host": 20, "mem_gb": 5.8, "disk_image_gb": 41 },
      "alloc": { "cpu": 4, "mem_gb": 6, "disk_gb": 90 }
    }
  ],
  "maintenance": { "last_run_at": 1793390400000, "last_result": "ok" }
}
```

ハートビートの応答（host 向け）：`{ "commands": [...], "peers": { "vm1": { "received_at": …, "maintenance": {...}, "busy": false }, "vm2": {...} } }`

送ってはいけないもの：パス、ファイル名、メールアドレス、トークン、ログ本文。セッションのタイトルだけは例外（9章の条件つき）。

---

## 5. 死活監視

| 最終受信からの経過 | 表示                 |
| ------------------ | -------------------- |
| 3分未満            | 正常（中身で判定）   |
| 3〜10分            | 遅延（黄）           |
| 10分以上           | 応答なし（赤）＋通知 |

各環境の表示は「host の報告」と「その環境のエージェントの報告」を合わせて決める。host の報告が途絶えたら全環境「応答なし」。VM のエージェントだけ途絶えたら、その VM は「要確認（エージェント停止）」。

| 資源                        | 注意（黄）               | 異常（赤）      |
| --------------------------- | ------------------------ | --------------- |
| ディスク使用率（host 全体） | 85%                      | 90%             |
| メモリ使用率（host 全体）   | 85%                      | 90%（10分継続） |
| CPU                         | 表示のみ（しきい値なし） | ー              |

| 起きたこと                            | 見え方                                                                                                                                        | 対応                                                                                         |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| ある環境のClaudeが停止                | その環境だけ「要確認」                                                                                                                        | launchdが自動再起動。続けば「Remote Controlを立て直す」                                      |
| ログイン切れ                          | その環境が「要ログイン」                                                                                                                      | 自動では直せない。通知→SSHで `claude auth login`                                             |
| VMが停止                              | そのVMが「停止」                                                                                                                              | 「VMを再起動」                                                                               |
| VMが起動中                            | そのVMが「起動中」（灰）                                                                                                                      | 2分待つ                                                                                      |
| VM のエージェントだけ停止             | そのVMが「要確認（エージェント停止）」                                                                                                        | 「VMを再起動」か、SSHで入ってエージェント再起動                                              |
| host のエージェントだけ停止           | 全環境「応答なし」（VM のエージェントの報告は届いている）                                                                                     | SSHで入ってエージェント再起動（`launchctl kickstart`）                                       |
| GUIセッションが落ちた（ログアウト等） | 全環境「応答なし」、SSH は通る                                                                                                                | SSH で入って再起動                                                                           |
| ホスト・回線の停止                    | 全環境「応答なし」、SSH不可。プラグの表示で「回線（プラグにも届かない）」「電源（消費電力がほぼ 0）」「エージェント（通電あり）」を切り分ける | ダッシュボードの「電源を入れ直す」（オーナーのみ）か SwitchBot アプリで電源を入れ直す（6.1） |

---

## 6. リモート操作

流れ：画面で押す → Worker が権限確認・`commands` に queued・監査ログ → 実行担当のエージェントがハートビート応答で受け取り running → 実行 → 結果を返す → 画面に done/failed。指示IDで二重実行を防ぐ。

状態遷移：`queued` →（エージェントが受領）`running` → `done` / `failed`。`queued` のまま `expires_at`（登録から 10 分。ホスト再起動は `not_before`＋10 分）を過ぎれば `expired`。`queued` の間だけ `canceled` にできる。同じ環境に `queued` / `running` の指示があるときは新しい指示を受け付けない（409）。

### 操作ホワイトリスト

| action                  | 対象    | 実行者            | 中身                                                                                                                                                                                                                                                                                     | 確認  | 権限           |
| ----------------------- | ------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | -------------- |
| `rc_restart`            | 各環境  | その環境          | remote-control を止めて同じフォルダで起動し直す                                                                                                                                                                                                                                          | 1回   | 本人・オーナー |
| `session_restore`       | 各環境  | その環境          | `claude remote-control --session-id <id>`（停止から約4時間以内）                                                                                                                                                                                                                         | 1回   | 本人・オーナー |
| `claude_update`         | 各環境  | その環境          | `claude update` → 立て直し → 接続確認                                                                                                                                                                                                                                                    | 1回   | 本人・オーナー |
| `codex_restart`         | 各環境  | その環境          | Codexの常駐を再起動（常駐できる場合のみ）                                                                                                                                                                                                                                                | 1回   | 本人・オーナー |
| `vm_restart`            | vm1/vm2 | host              | `tart stop` → launchd が再起動                                                                                                                                                                                                                                                           | 1回   | 本人・オーナー |
| `vm_stop` / `vm_start`  | vm1/vm2 | host              | 停止（自動起動も止める）/ 起動（3.5）                                                                                                                                                                                                                                                    | 1回   | 本人・オーナー |
| `rc_start_dir`          | 各環境  | その環境          | 作業フォルダ直下の `dir` を Claude Code の信頼済みフォルダとして記録してから（`~/.claude.json` の `projects[<実体パス>].hasTrustDialogAccepted = true` だけ書き、他は残す。13章 #21）、追加の `claude remote-control --name <dir>` を起動（13章 #13）                                    | 1回   | 本人・オーナー |
| `rc_stop_dir`           | 各環境  | その環境          | 上を停止                                                                                                                                                                                                                                                                                 | 1回   | 本人・オーナー |
| `rc_mkdir`              | 各環境  | その環境          | 作業フォルダ直下に `dir` を作る（名前は英数字で始まる 64 文字まで。`start` が true なら続けて `rc_start_dir` と同じ信頼の記録と起動をする）                                                                                                                                              | 1回   | 本人・オーナー |
| `rc_permission_set`     | 各環境  | その環境          | Remote Control の権限モードを `permission_mode`（`bypassPermissions` / `default`）に切り替え、メインとフォルダごとの RC を起動し直す（13章 #18）                                                                                                                                         | 1回   | 本人・オーナー |
| `claude_permission_set` | 各環境  | その環境          | Claude Code 全体の既定の権限モードを `permission_mode`（`bypassPermissions` / `default`）に切り替える。`~/.claude/settings.json` の `permissions.defaultMode`（bypass のときは `skipDangerousModePermissionPrompt: true` も）だけ書き換え、他のキーは残す。RC は立て直さない（13章 #20） | 1回   | 本人・オーナー |
| `host_restart`          | host    | host              | VMを止めてから `shutdown -r`                                                                                                                                                                                                                                                             | 2段階 | オーナーのみ   |
| `host_power_cycle`      | host    | Worker（`cloud`） | SwitchBot のクラウド API でプラグを turnOff → 次の Cron（約 1 分後）で turnOn（6.1）。host の報告が 10 分以上途絶えているときだけ受け付ける（409）                                                                                                                                       | 2段階 | オーナーのみ   |

- `agent_update`（エージェント自身の更新）は **v1 では作らない（決定）**。更新は Taro が SSH で入り、3 環境それぞれで `git pull` → `launchctl kickstart -k gui/<uid>/<label>`。手順は `docs/setup-mac.md` に書く。

### ホスト再起動の安全策

- オーナーだけが押せる。ホスト名（`host`）の手入力を挟み、押してから1分間は取り消せる（`not_before`。取り消しは `POST /api/commands/:id/cancel`）。
- エージェントは「`not_before` を過ぎていて、登録から 15 分以内で、host 向けの最新の指示」だけを実行する（古い指示で再起動ループにしない）。
- 実行手順：`vm_stop` 相当で VM を止める（自動起動は止めない）→ `result` を **done で先に送る** → `sudo /sbin/shutdown -r now`。先に done を送らないと `running` のまま残る。
- `shutdown` 用に sudoers でこの1コマンドだけ `NOPASSWD` で許可する。
- 最終手段：スマートプラグで電源断→復帰（6.1）。`host_power_cycle` にも同じ 2 段階確認・1 分の猶予・「登録から 15 分以内の最新の指示だけ」が効く。

### 6.1 スマートプラグ（SwitchBot プラグミニ。2026-10-31 導入決定、2026-11-01 ダッシュボード連携を決定）

Mac mini の電源ケーブルに挟み、エージェントも SSH も効かないときの最後の復旧手段にする。製品は **SwitchBot プラグミニ（JP）**。SwitchBot のクラウド API（v1.1）があるので、ダッシュボードから「電源の状態と消費電力の表示」と「電源の入れ直し」もできるようにする（13章 #22）。SwitchBot アプリからの手動操作は変わらず使える（クラウド API や Worker が壊れたときの逃げ道）。

| 項目                         | 内容                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 操作する人                   | Taro（オーナー）だけ。ダッシュボードの「Taro の環境 › 操作 › 電源を入れ直す」か、SwitchBot アプリ                                                                                                                                                                                                                                                                                             |
| 実行者                       | **Worker 自身**（`commands.executor = 'cloud'`）。1 分ごとの Cron が指示を拾い、`turnOff` → 次の回で `turnOn`。エージェントは関与しない（エージェントが死んでいる場面で使う機能なので、Mac 側に何も求めない）                                                                                                                                                                                 |
| 歯止め                       | オーナーのみ、ホスト名 `host` の手入力、1 分の取り消し猶予、登録から 15 分以内の最新の指示だけ実行（`host_restart` と同じ）。加えて **host の報告が 10 分以上途絶えている（「応答なし」）ときだけ受け付ける**（サーバーで判定。届いているときは 409 で「先にホスト再起動を」）。同じ環境に実行中の指示があれば 409                                                                            |
| 失敗時                       | `turnOff` に失敗 → failed（Mac はそのまま）。`turnOn` に失敗 → 1 分ごとに再試行し、5 分で諦めて failed。どちらも Slack に「操作が失敗」と理由、オンに失敗したときは「SwitchBot アプリで手動でオンにする」を添える                                                                                                                                                                             |
| 表示                         | Cron が 1 分ごとに状態を読み、`plug_status` に 1 行置く。host の画面の「状態」タイルと「詳細」、一覧の見出しに「電源プラグ オン · 42W」。オフなら全員に見える警告。「Mac mini 応答なし」のバナーと Slack に、プラグの様子（届かない／消費電力がほぼ 0／通電あり）で原因の切り分けを添える                                                                                                     |
| 秘密                         | token と secret は Worker の secret `SWITCHBOT_TOKEN` / `SWITCHBOT_SECRET`（アプリの開発者オプションで取る。**token はアカウント内の全機器を操作できる**）。機器 ID は `wrangler.toml` の `SWITCHBOT_PLUG_DEVICE_ID`。3 つ揃って初めて有効。D1・ログ・画面・Slack には出さない。アカウントは Taro が既に使っているもの（2026-11-01 決定。専用アカウントは作らない）                           |
| API                          | `https://api.switch-bot.com/v1.1`。ヘッダ Authorization（token）・sign・t（13 桁ミリ秒）・nonce。sign は token+t+nonce を secret で HMAC-SHA256 し base64。1 日 10,000 回まで（1 分ごとの取得で 1,440 回）。Webhook は署名が無く Access の外に口を開けることになるので使わない。`worker/src/switchbot.ts`                                                                                     |
| 置き方                       | プラグは Mac と別経路（自宅ルーターの 2.4GHz Wi‑Fi）。ルーターや回線が落ちているときは届かない（「届かない」と表示される）。ルーター自体の再起動は別の手段（ルーターの自動再起動設定など）で考える                                                                                                                                                                                            |
| 前提                         | 「電源が入ったら常に自動的に起動」（`pmset autorestartatconnect 1`。「停電後」ではなく「常に」。3.2）＋自動ログイン（FileVault オフ）＋launchd。この3つが揃っていないと電源を入れ直しても戻らない。プラグ自体が停電から戻ったときにオンで戻ること（オフのままだと Mac が二度と上がらない。アプリに設定項目は無く、抜き差しの試験で確かめる。11章）                                            |
| 手順                         | (1) 一覧が「応答なし」で、`ssh-host.example.com` にも入れないことを確認 → (2) 10 分待つ（一時的な回線断と区別する。ボタンもそれまで押せない）→ (3) バナーのプラグの様子を見る。「届かない」なら回線かルーターなので待つ → (4) 「電源を入れ直す」→ ホスト名を入力 → 1 分の猶予 → オフ → 約 1 分 → オン → (5) 3〜5 分で一覧に戻る。戻らなければアプリでオンになっているか確認し、だめなら実機へ |
| リスク                       | 強制電源断なのでディスク破損・書きかけファイルの損失があり得る。VM のイメージは特に大きいので、復帰後に `tart list` と VM 内の起動を確認する                                                                                                                                                                                                                                                  |
| 実機で確認済み（2026-11-01） | 状態の応答に `power` が入る。`weight` は現在の W（電圧×電流と一致）。署名は base64 のまま通る。token と secret は Worker の secret に登録済み、機器 ID は `wrangler.toml` に設定済み。残りは、プラグ自体が停電から戻ったときにオンで戻るかの抜き差し試験（11章）                                                                                                                              |

---

## 7. Claude の接続を保つ仕組み

**1. 勝手に切れないようにする**

- 各環境の `settings.json` の `env` で `DISABLE_AUTOUPDATER=1`（裏の自動更新を止める。手動 `claude update` は使える）
- `autoUpdatesChannel: "stable"`
- 更新は夜間メンテナンスでエージェントが行う
- Remote Control は各アカウントのプランで有効である必要がある（Team プランなら組織オーナーが有効化）。スマホから入るときはその環境のアカウントで Claude アプリにログインする。プッシュ通知もアカウントごと

**2. 切れても自動で戻す**

- launchd `KeepAlive` で同じフォルダで `claude remote-control` を再起動 → 約4時間以内なら前のセッションが戻る
- セッションIDを `sessions` に記録し、画面から `--session-id` で個別に戻せる
- 落ちたセッションはスマホからメッセージを送れば復帰（v2.1.238以降。要確認）

**3. 戻らないときに気づく**

- `--debug-file` のログを見張り、失敗が続けば立て直す（同じ環境で 1 時間に 3 回まで。超えたら通知して止める）
- ログイン切れは「要ログイン」表示＋Slack通知
- カードに Remote Control の状態、バージョン、最終再起動を出す

**夜間メンテナンス（エージェントが JST で実行。環境ごとに時刻をずらす。決定）**

| 時刻  | 実行者              | 内容                                                                                                                                                             |
| ----- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 04:00 | vm1 のエージェント  | 作業中判定 → 作業中なら `busy` を報告して見送り → `claude update` → `updated` を報告                                                                             |
| 04:10 | host のエージェント | `peers.vm1` が今夜 `updated` なら VM 再起動（メモリのリセットを兼ねる）。`busy` なら見送り。報告が無ければ（VM のエージェントが死んでいる）再起動する → 接続確認 |
| 04:20 | vm2 のエージェント  | vm1 と同じ                                                                                                                                                       |
| 04:30 | host のエージェント | vm2 の再起動（vm1 と同じ判定）                                                                                                                                   |
| 04:40 | host のエージェント | host 自身：作業中判定 → `claude update` → Remote Control だけ再起動 → 接続確認                                                                                   |

1. 作業中判定の材料の候補：`--debug-file` の直近 N 分の活動、`claude` プロセスの CPU、Remote Control の状態。実機で決める
2. 接続し直したか確認。だめなら1回立て直し、それでもだめなら Slack 通知
3. 結果を `maintenance` としてハートビートに載せる（画面の「最終再起動」に使う）

---

## 8. SSH・画面共有

### 8.1 ホスト名（Tunnel・ブラウザ表示）

| ホスト名               | 接続先         | 種類 |
| ---------------------- | -------------- | ---- |
| `ssh-host.example.com` | localhost:22   | SSH  |
| `vnc-host.example.com` | localhost:5900 | VNC  |
| `ssh-vm1.example.com`  | vm1のIP:22     | SSH  |
| `vnc-vm1.example.com`  | vm1のIP:5900   | VNC  |
| `ssh-vm2.example.com`  | vm2のIP:22     | SSH  |
| `vnc-vm2.example.com`  | vm2のIP:5900   | VNC  |

### 8.2 入り方は2通り

| 項目           | A. ブラウザで入る                              | B. WARP経由でアプリから入る                                                                                                                                                               |
| -------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 場面           | WARPのない端末、緊急時                         | 本人が普段使うスマホ・PC                                                                                                                                                                  |
| 端末に必要     | ブラウザだけ                                   | Cloudflare One Agent（WARP）、SSHアプリ、VNCアプリ                                                                                                                                        |
| 接続先         | 上の公開ホスト名                               | 各マシンの内部IP（`192.168.64.x`。3.4）                                                                                                                                                   |
| SSH認証        | ブラウザでAccessにログイン                     | WARPにログインした本人として短期証明書                                                                                                                                                    |
| 画面共有       | ブラウザ版VNC                                  | VNCアプリで `内部IP:5900`                                                                                                                                                                 |
| Cloudflare設定 | 公開ホスト名＋Accessアプリ（ブラウザ表示オン） | Tunnelで内部ネットワーク（`192.168.64.0/24`）を公開、WARPの端末登録、Access for Infrastructure のターゲット、画面共有用のネットワーク許可（Gateway のネットワークポリシーで 5900 を許可） |

- ブラウザのSSH/VNCは、Accessのメールの@より前＝接続先のユーザー名である必要がある。
- ブラウザ表示のAccessポリシーは Allow / Block のみ。
- 短期証明書を使うため、A・B どちらでも各マシンの sshd に Access の SSH CA 公開鍵を登録する（`/etc/ssh/sshd_config.d/` に `TrustedUserCAKeys`）。CA は 2 種類ある：A（ブラウザ表示）はアプリごとの SSH CA（3 本）、B（WARP）は Gateway SSH CA（1 本）。`ca.pub` には複数の鍵を並べられるので両方入れる。ブラウザ版 SSH は対応する鍵交換方式が決まっているので、通らなければ `sshd_config` を調整する。
- **WARP の Split Tunnel**：既定は「除外」モードで `192.168.0.0/16` など私設アドレスが丸ごと除外されている。`192.168.64.0/24` を除外から外さないと B は一切つながらない（設定手順に必ず入れる）。
- B では VM の内部IPを固定する（3.4）。
- 画面共有は各 macOS で「VNC ビューアがパスワードで画面を制御することを許可」をオンにする必要がある見込み。この VNC パスワードは各環境の本人（とオーナー）がパスワードマネージャーで持ち、ダッシュボードには出さない。
- SSH・VNC の Access アプリはセッション時間を短め（例：SSH 1 時間、VNC 1 時間、ダッシュボード 24 時間）にする。

### 8.3 SSHに入れる人（Accessのポリシーで管理）

| マシン | 誰の環境か | 入れる人                 |
| ------ | ---------- | ------------------------ |
| host   | Taro       | Taro                     |
| vm1    | Hanako     | Hanako、Taro（オーナー） |
| vm2    | Jiro       | Jiro、Taro（オーナー）   |

---

## 9. アクセス制御

| ロール                | 閲覧 | 自分の環境の操作・接続 | 他人の環境の操作 | ホスト再起動 |
| --------------------- | ---- | ---------------------- | ---------------- | ------------ |
| 閲覧者                | ○    | ×                      | ×                | ×            |
| 本人（Hanako / Jiro） | ○    | ○                      | ×                | ×            |
| オーナー（Taro）      | ○    | ○                      | ○                | ○            |

- Access のログインは **Google**（決定）。Cloudflare Zero Trust に Google を IdP として登録し、ワンタイム PIN は使わない。
- ロールはメールアドレスから決める（`MEMBERS_JSON`、4.2）。オーナーのメール：`taro@example.com`。他のメンバーは設定値で持つ（未確定）。
- `*.pages.dev` / `*.workers.dev` の既定ドメインは無効にする（カスタムドメインだけで配信）。
- 全操作を `audit_log` に残し、画面に表示する。
- 閲覧者には「接続」「ログイン情報」「操作」のセクションを出さない（API も 403）。見えるのは状態・使用量・履歴だけ（決定）。
- Remote Control のセッションは各Claudeアカウントにしか見えない。ダッシュボードに会話内容は出さない。
- **セッションのタイトルは例外として扱う（決定）**。復元画面で選びやすくするため表示する。ただし条件つき：(1) 本人とオーナーにだけ返す（`GET /api/sessions`）、(2) 先頭 60 文字まで、(3) `sessions` テーブルにだけ保存し `heartbeats` / `heartbeat_history` には残さない、(4) Slack 通知と `audit_log` には出さない、(5) `last_seen` から 7 日で削除。CLAUDE.md の「会話内容を出さない」にこの例外を書く。
- 秘密情報の置き場：Cloudflare 側は `wrangler secret`（Slack Webhook、`MEMBERS_JSON` は平文の環境変数でよい）。Mac 側はサービストークンを `chmod 600` のファイル（`~/.config/macmini-agent/`）に置き、ログに出さない。環境ごとに別トークン。更新手順を `docs/setup-mac.md` に書く。

---

## 10. 画面

`design/` のモックを参照。画面は5つ：一覧、Taro の環境、Hanako の環境、Jiro の環境、接続ガイド。

- 一覧：全体ステータス、警告バナー、Mac mini全体（使用量の積み上げバー／リソース配分）、各環境カード（状態、Claude/Remote Control/Codex/VM、使用量、詳細へのリンク）、操作履歴、最近のイベント
- 各環境：接続（A/B）、SSHの認証（入れる人）、ログイン情報（パスワードは表示しない）、操作、状態（使用量・割り当て・バージョン・最終再起動）、このマシンの履歴
- 説明文は「説明」ボタンで開閉
- 実行中の指示はカードに「実行中…」と出し、`queued` の間は取り消しボタンを出す。ホスト再起動は猶予の残り秒数を表示
- 時刻は JST。「最終受信 12秒前」は端末の時計ではなくサーバーの受信時刻との差で出す

---

## 11. 未確認事項（実機で先に確かめる）

Mac・Tart

- [ ] 実機のCPUコア数（M4かM4 Proか）、VMのメモリが再起動まで戻らないかの実測
- [ ] FileVault をオフにしたあと（`fdesetup status` で Off）、自動ログインが有効にできること
- [ ] `pmset -g` の現状と、設定後に 24 時間以上スリープしないこと
- [ ] Tart で `--no-graphics` 起動したVMに、ゲストの画面共有で入れるか
- [ ] Tart の VM の IP が再起動でどの程度変わるか、ゲスト内静的IP／ブリッジのどちらで固定するか
- [ ] VMごとの仮想化プロセスを特定し、使用量をVMごとに分けられるか
- [ ] ゲスト macOS の自動ログイン・スリープ無効・ソフトウェア更新オフが VM 内でも効くか
- [ ] `192.168.64.1` でホストの sshd に届くか（B の内部IPを揃えるため）
- [ ] VM 内から Cloudflare（`workstation.example.com`）へ NAT 越しに届くこと（エージェントを VM に置くため）

Claude / Codex

- [ ] SSHだけで入ったVMで `claude remote-control` がキーチェーンのロックで認証につまずかないか（VMも自動ログインにすれば回避できる見込み）
- [ ] launchd 配下での `claude remote-control` の長期安定性
- [ ] Remote Controlが実際に外れる原因（更新後の再起動か、ログイン切れか）
- [ ] ログに出る接続失敗の文言と、「Claudeが作業中」の判定方法
- [ ] `--session-id` の取り方と、停止→再起動でセッションが戻るか。タイトルをどこから取るか
- [ ] 各アカウント（A/B/C）のプランで Remote Control が使えるか
- [ ] Codex Remote が画面なしの CLI だけで使えるか（Codexデスクトップアプリが必要か）

Cloudflare

- [ ] example.com の DNS を Cloudflare で管理しているか
- [ ] Google を Access の IdP として登録できるか（Google Workspace の管理権限）
- [ ] macOSの画面共有が Cloudflare のブラウザ版VNCで使えるか（VNC パスワード方式）
- [ ] 短期証明書でのSSHの設定手順（sshd側・端末側cloudflared）。ブラウザ版 SSH の鍵交換方式
- [ ] WARP の Split Tunnel で `192.168.64.0/24` を通せるか
- [x] iPhoneのSSHアプリとVNCアプリが WARP 経由・短期証明書でつながるか → WebSSH は OK、Termius は NG（Cloudflare の SSH プロキシと相性）。Wi‑Fi では iOS のローカルネットワーク許可が必要（2026-11-01）
- [ ] WARP の「チーム名」、各メンバーのメールアドレス、内部IP
- [ ] Slack の Incoming Webhook を作れるか（example の Slack の権限）と通知先チャンネル

SwitchBot（6.1）

- [x] 状態取得（`GET /v1.1/devices/{id}/status`）の応答に `power`（"on"/"off"）が入る → 2026-11-01 実機で確認。`power: "on"` が入る
- [x] `weight` は **現在の W** → 2026-11-01 確認。`weight: 4` のとき `voltage: 102.4`・`electricCurrent: 39`（mA）で 102.4 × 0.039 ≒ 4 W と一致。`electricityOfDay` は当日の分（単位は未確認）。Mac mini がアイドルで 2〜4 W（実測 4 W と 2.3 W）なので、「ほぼ 0」のしきい値は 1 W（`PLUG_OFF_LIKE_W`）
- [x] sign は base64 のまま（大文字化しない）で通る → 2026-11-01 確認
- [ ] プラグの「通電時の状態」（停電から戻ったときにオンで戻る）→ 2026-11-01 アプリに設定項目は無い（Taro 確認）。公式の仕様も見つからず、分解記事に「オンのまま抜き差しすると次回もオン」という個人の検証があるだけ。**実機で確かめる**：Mac で作業中のものが無いときに、プラグ本体をコンセントから抜いて 30 秒後に差し直し、プラグがオンで戻って Mac が起動するか（verify A-4 と同時にやる）
- [x] token はアカウント内の他の機器も見える → 2026-11-01 確認。一覧にプラグミニ（機器名「Mac mini」、ID `<deviceId>`）のほかハブミニと赤外線リモコン 1 つ

## 12. 参考

- Remote Control：https://code.claude.com/docs/en/remote-control
- Claude Code のセットアップと更新：https://code.claude.com/docs/en/setup
- Cloudflare ブラウザ表示：https://developers.cloudflare.com/cloudflare-one/applications/non-http/browser-rendering
- Cloudflare ブラウザ版VNC：https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/use-cases/vnc-browser-rendering/
- Access for Infrastructure（SSH）：https://developers.cloudflare.com/changelog/post/2024-10-01-ssh-with-access-for-infrastructure/

## 13. 設計判断の記録（2026-10-31、Taro が決定）

| #   | 論点                                                      | 決定                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 理由・トレードオフ                                                                                                                                                                                                                                     |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | FileVault                                                 | **オフ**。スマートプラグも導入する                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | オンだと自動ログインが使えず、電源断から無人で復帰できない。代わりに強いログインパスワード・物理的な保管場所で守る                                                                                                                                     |
| 2   | cloudflared の動かし方                                    | **LaunchDaemon（root）＋ローカル設定ファイル**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | GUIセッションが壊れても SSH で入れる経路を残す。エージェントは cloudflared を触らない                                                                                                                                                                  |
| 3   | VM の IP                                                  | **固定する**（方法は実機で決める）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 「IP 変化を検知して cloudflared を書き換える」機能を作らない                                                                                                                                                                                           |
| 4   | セッション名の表示                                        | **タイトルも出す**（9章の条件つき）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 復元画面で選びやすくする。本人・オーナー限定、60文字、履歴と通知には残さない。CLAUDE.md の原則に例外を追記                                                                                                                                             |
| 5   | `agent_update`                                            | **v1 では作らない**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | ネットから新版を取ってくる経路はサプライチェーンの穴になる。更新は SSH で `git pull`＋`launchctl kickstart`                                                                                                                                            |
| 6   | VM 内の監視                                               | **各 VM にもエージェントを置く**（同じプログラム、`--env`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | ホスト→VM の鍵配布とキーチェーン問題を避ける。常駐は 3 つ、サービストークンも 3 本                                                                                                                                                                     |
| 7   | 構成の統合                                                | **Workers 1 つに統合**（静的アセット＋API＋Cron）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | D1 バインディングと wrangler 設定が 1 つ。CLAUDE.md の記述を更新                                                                                                                                                                                       |
| 8   | 通知                                                      | **Slack（example の Slack）**。条件は 4.3 の表                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Discord から変更。Incoming Webhook を使う                                                                                                                                                                                                              |
| 9   | 閲覧者の見える範囲                                        | **状態・使用量・履歴だけ**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 接続ボタン・ログイン情報・操作は出さない                                                                                                                                                                                                               |
| 10  | バックアップ                                              | **対象外**。作業は git に push                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | VM イメージは Time Machine から除外                                                                                                                                                                                                                    |
| 11  | Access のログイン方法                                     | **Google**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | IdP 設定が要るが、毎回の PIN 入力がない                                                                                                                                                                                                                |
| 12  | 夜間メンテナンスの時刻                                    | **04:00 / 04:10 / 04:20 / 04:30 / 04:40** にずらす                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | VM 内の更新と host からの VM 再起動を 10 分ずらして連携する（7章）                                                                                                                                                                                     |
| 13  | フォルダを選んで Remote Control を起動                    | **実装する**（2026-10-31 オーナーの指示）。作業フォルダ（`~/workspace`）直下のフォルダ名だけをダッシュボードに出し、選んだフォルダで追加の `claude remote-control` をエージェントの子プロセスとして起動・停止する（`rc_start_dir` / `rc_stop_dir`）。フォルダの新規作成もダッシュボードから（`rc_mkdir`。2026-11-01 オーナーの指示。作成後にそのまま起動するオプション付き）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | フォルダ名は CLAUDE.md 3 の「ファイル名を送らない」の例外。本人・オーナーにだけ表示し、パスは送らない                                                                                                                                                  |
| 14  | Remote Control の初回同意「Enable Remote Control? (y/n)」 | **エージェントが y を書き込む**（2026-11-01 オーナーの指示）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | ダッシュボードで本人（Access ログイン済み）が「起動」を押した操作をそのまま端末に反映するだけで、AI が自発的に押す経路は無い                                                                                                                           |
| 15  | Remote Control の作業フォルダ                             | **`~/workspace`**（全プロジェクトの親）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | ホーム直下は信頼設定が保存されないため 1 つ下。Claude Code は作業フォルダ外のファイルも読み書きできる                                                                                                                                                  |
| 16  | VNC パスワードの扱い                                      | **ダッシュボードに表示する**（2026-11-01 オーナーの決定。「ダッシュボードに入る時点で Zero Trust なので」）。Worker の secret `VNC_PASSWORDS_JSON`（環境ごと）に置き、`GET /api/vnc-password?env=` で本人・オーナーにだけ返す。画面では「パスワードを表示」を押したときだけ 60 秒出す。D1・ハートビート・ログには置かず、見たことだけ監査ログ `vnc.password.view` に残す                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | CLAUDE.md 3 の例外に追加。値の登録は `wrangler secret put`（vm1/vm2 は構築時に生成したもの、host は Taro が設定したもの）                                                                                                                              |
| 17  | オーナー（Taro）の VM への SSH                            | **Access 経由では入らない**（2026-11-01 オーナーの決定。「taro は本来は入れなくていい」）。VM の中の作業は host から構築用の鍵で行う。ダッシュボードの SSH コマンドはそのマシンの利用者名（hanako / jiro）で出す                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | VM に taro ユーザーは作らない。Access のポリシー（vm1/vm2 users に taro を含む）はブラウザ版 VNC などのために残す                                                                                                                                      |
| 19  | Codex の常駐の形                                          | **ChatGPT デスクトップアプリ**（2026-11-01。Taro が host に導入）。ログイン項目に入れて自動起動、アプリの Remote Control でスマホから接続。エージェントは config の `codex_app` でアプリのプロセスを監視し、`codex_restart` はアプリを終了して開き直す。基礎設定「Codex の常駐」はログイン項目に入っているかを見る                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 同梱 CLI の `codex app-server daemon bootstrap --remote-control` で画面無しの常駐もできる（未検証）。VM は利用者が ChatGPT.app を入れて自分のアカウントでログインする                                                                                  |
| 18  | Remote Control の権限モード                               | **既定で `bypassPermissions`**（2026-11-01 オーナーの決定。「この Mac は Claude 専用」）。各 Mac の `~/.config/macmini-agent/rc.json` の `permission_mode` を `claude-rc.sh` とフォルダごとの RC が読み、`--permission-mode` を付けて起動する。ダッシュボードの「操作」で本人・オーナーが環境ごとにオン／オフでき（`rc_permission_set`）、切り替えると RC を立て直す。現在の値はハートビートの `claude.rc_permission_mode` で画面に出す                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | RC 越しに書き込み・コマンド実行の許可を求めなくなる。利用者ごとに判断できるよう画面で切り替えられるようにした                                                                                                                                          |
| 20  | Claude Code 全体の既定の権限モード                        | **既定で `bypassPermissions`**（2026-11-01 オーナーの決定）。各 Mac の `~/.claude/settings.json` に `permissions.defaultMode: "bypassPermissions"` と `skipDangerousModePermissionPrompt: true` を置く。ダッシュボードの「操作」で本人・オーナーが環境ごとにオン／オフでき（`claude_permission_set`）、基礎設定 `claude.default_bypass` で確認する（オンが ok）。画面の現在値はこのチェック結果から出す。settings.json の中身はダッシュボードに送らない（env に秘密が入ることがあるため、判定だけ送る）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | ターミナルで起動した claude も RC と同じく許可を求めないようにする。#18 は RC だけ、#20 は対話起動の既定                                                                                                                                               |
| 23  | メインの Remote Control の初回の答え                      | **エージェントが起動時と `rc_restart` のたびに記録する**（2026-11-01 オーナーの決定。カードで選択）。`~/.claude.json` の `projects[~/workspace].hasTrustDialogAccepted = true`（信頼）と `remoteDialogSeen = true`（「Enable Remote Control? (y/n)」の y。claude 2.1.316 の本体で確認）を、無ければ書く。利用者の初期設定は「画面共有で入る → 設定アシスタントを閉じる → `claude auth login`」だけになる                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | #14・#21 の「本人がダッシュボードで押した操作の反映」の線を一歩越えるが、launchd に RC を載せること自体が本人の意思で、この Mac は Claude 専用。代案（「Remote Control を立て直す」を押したときだけ記録）は初期設定にボタン 1 回が残るので採らなかった |
| 22  | スマートプラグとダッシュボードの連携                      | **連携する**（2026-11-01 オーナーの決定。「ダッシュボードから操作できるようにする。電源と消費電力の表示、電源の入れ直しを全部。既に使ってるアカウントを使う」）。6.1 の「v1 では連携しない」を撤回。製品は SwitchBot プラグミニ（JP）。Worker が SwitchBot のクラウド API を呼び、エージェントは関与しない。`host_power_cycle` は `host_restart` と同じ 2 段階確認に加え、host の報告が 10 分以上途絶えているときだけ受け付ける                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 消費電力で「回線」「電源」「エージェント」を切り分けられる。token はアカウント内の全機器を操作できるが、オーナーの判断で既存アカウントを使う（Worker の secret にだけ置く）。Webhook は署名が無いので使わない                                          |
| 21  | 起動＝そのフォルダを信頼する                              | **起動のときに必ず信頼を記録する**（2026-11-01 オーナーの決定「起動するということは信頼する前提なので、起動ボタンだけにし、起動時には絶対に信頼をとりに行く」）。claude（2.1.316 で確認）はフォルダを「cwd そのものが `~/.claude.json` の projects で `hasTrustDialogAccepted: true`」か「信頼済みの祖先フォルダが cwd と同じ git リポジトリの中にある」ときだけ信頼済みとみなす。空フォルダは `~/workspace` の信頼を引き継ぐが、中に git リポジトリができると別の境界になり、次の起動から `Workspace not trusted` で落ちる（panda で実際に起きた。verify 参照）。そこで `rc_start_dir` と `rc_mkdir`（作成後に起動）は、起動の前にそのフォルダの信頼フラグだけを `~/.claude.json` に書く。対話起動の信頼ダイアログで「はい」と答えたのと同じ項目を、本人が「起動」を押した意思の反映として書く（#13 の「y を入力」と同じ考え方。AI が自発的にフォルダを信頼する経路は無い）。ダッシュボードのボタンは「起動」だけ（いったん作った「信頼して起動」と指示 `rc_trust_dir` は同日に廃止。履歴の表示名だけ残す） | `~/.claude.json` は claude も書くファイルなので、読み→書き→rename の短い窓で claude の書き込みと競合する可能性は残る。書くのは信頼フラグ 1 つで、ほかのキーは読んだまま戻す。中身はダッシュボードに送らない                                            |
| 24  | VM の台数                                                 | **0〜2 台から選べる**（2026-11-02 オーナーの決定）。環境の名前は host・vm1・vm2 のまま固定し、使う VM は `MEMBERS_JSON.envs` に書いたものだけ（host は必須）。書かなかった VM は一覧・ナビに出さず、報告・指示・通知も受け付けない。エージェント（host）は設定 `vms`（省略時は両方）の VM だけを見る。`AGENT_TOKEN_NAMES` は使う環境の分だけ必須                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | macOS の使用許諾では、1 台の Mac で動かせる macOS の VM は 2 つまで。3 台以上にする方法（2 台目の Mac、マシン単位の設定）は今後の検討（環境 ID を任意にする改修が要る）                                                                                |
