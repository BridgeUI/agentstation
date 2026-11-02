# Mac 側の導入手順（フェーズ2・設計時の詳細リファレンス）

> **実機で確定した手順は `docs/initial-setup.md`**。この文書は設計時に書いた詳細版で、「要確認」の多くは `docs/verify.md` で決着している。食い違うときは initial-setup.md と verify.md が正。

Mac mini（host）と Tart の VM 2 台（vm1 / vm2）に、常駐の仕組みを入れる手順。`docs/tasks.md` フェーズ2の成果物。
テンプレートは `mac/` にある。各手順に「期待する結果」を書き、実機で確かめていない箇所は **要確認（verify.md X-n）** と記す（`docs/verify.md` の項目番号）。

- コマンドは 1 行ずつ。`sudo` が付くものは管理者パスワードを聞かれる
- 秘密情報（トークン・パスワード）はこの文書に書かない。置き場だけ書く
- macOS 26（Tahoe）系の画面名は「システム設定 › …」で書く。名称が不確かな箇所は「名称は要確認」と添える
- 進んだら `mac/scripts/check.sh` を実行して OK / NG を見る（副作用なし）

目次

1. 前提と決定事項
2. host の基礎設定
3. ツールの導入
4. VM の作成と配分
5. Claude の設定
6. エージェント
7. cloudflared
8. launchd の配置と起動順、動作確認
9. ログローテーション、sudoers、sshd
10. 再起動と電源断の試験
11. 更新手順
12. やってはいけないこと

付録 A. VM ゲスト用チェックリスト

---

## 1. 前提と決定事項

`docs/spec.md` 13章で決定済み。ここでは変えない。

| 項目 | 決定 | 影響する手順 |
| --- | --- | --- |
| FileVault | **オフ**。自動ログインを使うため | 2.3 |
| スマートプラグ | **導入する**。最後の復旧手段 | 10.2 |
| cloudflared | **LaunchDaemon（root）＋ローカル設定ファイル** `/etc/cloudflared/config.yml` | 7 |
| VM の IP | **固定する**。方法は実機で決める（ゲスト内静的 IP かブリッジ） | 4.3 |
| ユーザー名 | Access のメールの @ より前（`taro` / `hanako` / `jiro`） | 2.1 |
| エージェント | 同じプログラムを 3 環境に置き、`--env` で切り替え。サービストークンは環境ごとに別 | 6 |
| 通知 | Slack。Mac 側には設定は無い | ー |

前提となる物：Mac mini（24GB / 512GB）、有線 LAN、スマートプラグ、HDMI ダミープラグ（任意）、3 つの Claude アカウント（A/B/C）、3 つの ChatGPT アカウント（Codex 用）。

フェーズ1（`docs/verify.md`）の ★ 項目が済んでいることが前提。特に A-1（機種とコア数）と B-2（VM の IP 固定方法）の結果が無いと 4 章が確定しない。

---

## 2. host の基礎設定

### 2.1 ユーザー名

ログインユーザーの短い名前が `taro` であること（Access のメール `taro@example.com` の @ より前。ブラウザ版 SSH / VNC がこの一致を要求する。spec 3.2）。

```bash
whoami
dscl . -read /Users/$(whoami) RecordName
```

期待する結果：`taro`。違う場合は新しい管理者ユーザー `taro` を作ってそちらで運用する（既存ユーザーの短い名前の変更は副作用が大きいので避ける）。パスワードは強いものにする（FileVault を切る分、ここが最後の砦）。

### 2.2 自動ログイン

システム設定 › ユーザとグループ › 自動ログイン で `taro` を選ぶ（FileVault オン時は灰色で選べない。先に 2.3）。

```bash
defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser
```

期待する結果：`taro`。再起動するとログイン画面を経ずにデスクトップまで進む（要確認 verify.md A-2）。

### 2.3 FileVault オフ

```bash
fdesetup status
```

`FileVault is On.` なら、システム設定 › プライバシーとセキュリティ › FileVault でオフにする（または `sudo fdesetup disable`）。復号には時間がかかる。

```bash
fdesetup status
```

期待する結果：`FileVault is Off.`（要確認 verify.md A-2）。

### 2.4 電源・スリープ（pmset）

```bash
bash mac/scripts/pmset-setup.sh
```

期待する結果：`pmset -g` に `sleep 0`、`disksleep 0`、`displaysleep 10`、`autorestartatconnect 1`、`powernap 0`、`womp 1` が並ぶ。あわせてシステム設定 › エネルギー で「ディスプレイがオフのときに自動でスリープさせない」がオン、「自動的に起動」が **常に**（「停電後」ではない。2026-11-01 変更。意図してシャットダウンしたあとにスマートプラグで電源を入れ直しても起動させるため）。

24 時間後：

```bash
pmset -g log | grep -E "Sleep|Wake" | tail -20
uptime
```

期待する結果：`Entering Sleep` が無く、`uptime` が途切れていない（要確認 verify.md A-3）。

### 2.5 自動更新オフ

macOS：システム設定 › 一般 › ソフトウェアアップデート › 自動アップデート（ⓘ）で「macOS アップデートをインストール」をオフ。「セキュリティ対応とシステムファイルをインストール」は残してよい。

```bash
sudo softwareupdate --schedule off
softwareupdate --schedule
```

期待する結果：`Automatic checking for updates is turned off`（要確認 verify.md A-5）。

App Store：システム設定 › App Store で「自動アップデート」をオフ（名称は要確認）。

Homebrew：

```bash
grep -q HOMEBREW_NO_AUTO_UPDATE ~/.zprofile || echo 'export HOMEBREW_NO_AUTO_UPDATE=1' >> ~/.zprofile
```

Claude Code の自動更新は 5.3 で止める。Tart・cloudflared は手動更新（11 章）。

### 2.6 ネットワーク（有線 LAN と DHCP 予約）

- システム設定 › ネットワーク で有線（Ethernet）が接続済みで、Wi‑Fi より優先になっていること（サービスの順序。名称は要確認）
- ルーターの DHCP 予約で Mac mini の LAN IP を固定する（手順はルーターによる）
- 家庭の LAN のアドレス帯が `192.168.64.0/24` と重なっていないこと（Tart の NAT と衝突する。spec 3.4）

```bash
ipconfig getifaddr en0
networksetup -listnetworkserviceorder | head -5
```

期待する結果：`en0`（有線）に予約した IP が付いている。（要確認 verify.md A-6：en0 が有線か、Wi‑Fi と番号が入れ替わっていないか）

受信ポートは開けない。macOS のファイアウォールはオンのままでよい。

### 2.7 タイムゾーンと時刻同期

```bash
sudo systemsetup -settimezone Asia/Tokyo
sudo systemsetup -setusingnetworktime on
systemsetup -gettimezone
```

期待する結果：`Time Zone: Asia/Tokyo`。

### 2.8 SSH と画面共有

システム設定 › 一般 › 共有 で「リモートログイン」と「画面共有」をオン。画面共有の ⓘ で「VNC ビューアがパスワードで画面を制御することを許可」をオンにし、VNC パスワードを設定する（パスワードマネージャーに保存。ダッシュボードには出さない。spec 8.2）。

```bash
nc -vz 127.0.0.1 22
nc -vz 127.0.0.1 5900
```

期待する結果：どちらも `succeeded`。VNC パスワード方式が Cloudflare のブラウザ版 VNC で使えるかは **要確認（verify.md D-5）**。

### 2.9 Time Machine / Spotlight から `~/.tart` を除外

Tart を入れて VM を作ったあと（4 章）に行う。

```bash
mkdir -p ~/.tart
tmutil addexclusion ~/.tart
tmutil isexcluded ~/.tart
```

期待する結果：`[Excluded]`。Spotlight は システム設定 › Siri と Spotlight › Spotlight のプライバシー（名称は要確認）に `~/.tart` を追加する。

バックアップ自体は対象外（決定）。作業内容は各環境で git に push する。

### 2.10 HDMI ダミープラグ（任意）

画面共有の解像度のために HDMI ダミープラグを挿す。挿したあと システム設定 › ディスプレイ で解像度が選べればよい。

---

## 3. ツールの導入（host）

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew --version
```

nodebrew と Node 24（`docs/dev.md` と同じ）：

```bash
brew install nodebrew
nodebrew setup
nodebrew install v24
nodebrew use v24
grep -q nodebrew ~/.zprofile || echo 'export PATH=$HOME/.nodebrew/current/bin:$PATH' >> ~/.zprofile
~/.nodebrew/current/bin/node -v
```

期待する結果：`v24.x.x`。plist はこの絶対パス `~/.nodebrew/current/bin/node` を使う。

Tart と cloudflared：

```bash
brew install cirruslabs/cli/tart
brew install cloudflared
/opt/homebrew/bin/tart --version
/opt/homebrew/bin/cloudflared --version
```

Claude Code（ネイティブ版。`~/.local/bin/claude` に入る想定。要確認 verify.md C-1：`which claude` の結果で plist のパスを直す）：

```bash
curl -fsSL https://claude.ai/install.sh | bash
which claude
claude --version
```

Codex（verify.md C-5 で決定：ChatGPT デスクトップアプリ）：

1. https://chatgpt.com/ から ChatGPT.app を入れ、その環境の ChatGPT アカウントでログインする
2. アプリの設定で Remote Control（Codex）を有効にし、スマホの ChatGPT アプリから接続する
3. ログイン項目に入れる（再起動後に自動で開く）：

```bash
osascript -e 'tell application "System Events" to make login item at end with properties {path:"/Applications/ChatGPT.app", hidden:false}'
```

4. `~/.config/agentstation/config.json` に `"codex_app": "/Applications/ChatGPT.app"` を足す（エージェントがプロセスを監視し、「Codex を再起動」でアプリを開き直す）

CLI だけで常駐させたい場合（未検証）：アプリ同梱の `codex app-server daemon bootstrap --remote-control`。

---

## 4. VM の作成と配分（host）

### 4.1 作成

ベースイメージは手元の判断で選ぶ（macOS 26 系のイメージ名は **要確認 verify.md B-1**）。

```bash
tart clone ghcr.io/cirruslabs/macos-sequoia-base:latest vm1
tart clone ghcr.io/cirruslabs/macos-sequoia-base:latest vm2
tart set vm1 --cpu 4 --memory 6144 --disk-size 90
tart set vm2 --cpu 4 --memory 6144 --disk-size 90
tart list
```

期待する結果：`tart list` に vm1 / vm2 が `stopped` で出る。配分は spec 3.3（4 コア / 6GB / 90GB）。A-1 の結果でコア数が足りなければ減らす。

### 4.2 初回起動とゲストの基礎設定

初回は画面付きで起動し、ゲスト内のユーザーを作る。

```bash
tart run vm1
```

ゲストの中で：

1. 管理者ユーザーを作る。短い名前は **vm1 → `hanako`、vm2 → `jiro`**（2.1 と同じ理由）。ベースイメージの既定ユーザー（例：admin）は、新ユーザーで入れることを確認してから削除するか無効にする（要確認：イメージの既定ユーザー名）
2. 新ユーザーでログインし直し、**付録 A のチェックリスト**（自動ログイン、pmset、自動更新オフ、リモートログイン、画面共有、タイムゾーン）を入れる。FileVault は VM 内では通常オフ
3. 3 章と同じ手順で Homebrew・nodebrew・Node・Claude Code・Codex を入れる（Tart と cloudflared はゲストには不要）
4. `sudo shutdown -h now` で止める

実機（2026-11-01）では画面無しで進めた：`mac/scripts/vm-guest-stage1.sh`（admin で）→ `vm-guest-stage2.sh`（利用者で）→ `vm-guest-stage3.sh`（IP 固定）→ 再起動。再起動後は利用者が自動ログインするが、**新しいユーザーの初回ログインでは「設定アシスタント」が出る**ので、画面共有（`vnc-vm1.example.com` か host の「画面共有」アプリで `vnc://192.168.64.10`）で入って最後まで進める。stage1 が admin の完了済み記録をコピーするので大半は飛ぶが、macOS 26.6 では「Update Mac Automatically」の 1 画面だけ残る（「Only Download Automatically」→「Continue」）。それが終わるまで Claude のログインはできない。

ホストから：

```bash
tart run --no-graphics vm1 &
sleep 90
tart ip vm1
ssh hanako@$(tart ip vm1) "pmset -g | grep -E ' sleep|disksleep'; fdesetup status; whoami"
nc -vz $(tart ip vm1) 5900
```

期待する結果：`sleep 0`、`FileVault is Off.`、`hanako`、5900 が `succeeded`。「画面共有」アプリで `vnc://<vm1 の IP>` に入れる（要確認 verify.md B-5）。

### 4.3 IP の固定（2 案。verify.md B-2 の結果で決める）

**(a) ゲスト内で静的 IP**（Tart の NAT のまま。WARP 経由の内部 IP を `192.168.64.0/24` に揃えられる。spec 3.4 で推奨）

ゲストの システム設定 › ネットワーク › Ethernet › 詳細 › TCP/IP で手動設定：vm1 は `192.168.64.10`、vm2 は `192.168.64.11`、サブネット `255.255.255.0`、ルーター `192.168.64.1`、DNS `192.168.64.1`（名称は要確認）。

```bash
ping -c 3 192.168.64.10
ssh hanako@192.168.64.10 uptime
```

静的 IP にすると `tart ip vm1` は DHCP リースに無いので「no IP address found」になる。`tart ip vm1 --resolver arp` なら引ける（エージェントは DHCP → ARP の順に試す。実機 vm1 で確認済み）。

**(b) ブリッジ**（`--net-bridged=en0`。ルーターの DHCP 予約で固定。VM が家庭の LAN に直接出る）

`mac/launchd/com.example.tart-vm1.plist` の `ProgramArguments` に `<string>--net-bridged=en0</string>` を足す。この場合 WARP 経由の内部 IP は家庭の LAN のものになり、spec 3.4 の「`192.168.64.0/24` に揃える」が成り立たないので、cloudflare 担当の設定（Tunnel の内部ネットワーク、Split Tunnel）も合わせて変える。

期待する結果：VM を 3 回再起動しても同じ IP で SSH できる。採用した方を `docs/verify.md` B-2 に書く。

### 4.4 ホスト側の `192.168.64.1`

VM が 1 台でも動いている状態で：

```bash
ifconfig | grep -A3 bridge100
ssh taro@192.168.64.1 uptime
```

期待する結果：`bridge100` に `192.168.64.1` が付き、SSH が通る（要確認 verify.md B-3）。

### 4.5 VM 内から Cloudflare へ

ゲストの中で：

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://www.cloudflare.com/
```

期待する結果：`200`（要確認 verify.md B-6）。これが通らないと VM のエージェントが報告できない。

---

## 5. Claude の設定（host / vm1 / vm2 それぞれで）

### 5.1 作業フォルダ

ホームそのもの・`~/Desktop`・`~/Documents`・`~/Downloads` は使わない（launchd から読めない TCC 保護フォルダ／iCloud で場所が変わる。spec 3.1）。実機は `~/workspace`（全プロジェクトの親。spec 13章 #15）。

```bash
mkdir -p ~/workspace
```

### 5.2 ログイン

その環境のアカウント（host=A、vm1=B、vm2=C）でログインする。

```bash
claude auth login
```

作業フォルダ（`~/workspace`）の信頼と Remote Control の初回同意は、**エージェントが起動時と「Remote Control を立て直す」のたびに `~/.claude.json` に記録する**（`agent/src/claudetrust.ts` の prepareMainRc。2026-11-01 変更、spec 13章 #23）。`claude remote-control` は初回「Enable Remote Control? (y/n)」を対話で聞き、launchd（端末なし）では答えられない（verify C-1）が、同意の記録 `remoteDialogSeen: true` があれば聞かれない。手で対話起動する必要はない。

期待する結果：エージェントの out.log に「Remote Control の初回の答えを記録した」。launchd から起動したとき `Workspace not trusted` も同意待ちも出ない。各アカウントのプランで Remote Control が使えること（要確認 verify.md C-4）。

### 5.3 settings.json（自動更新オフ）

`mac/claude/README.md` の手順で `mac/claude/settings.fragment.json` を `~/.claude/settings.json` にマージする。

```bash
cd ~/workspace/agentstation/mac/claude
test -f ~/.claude/settings.json || cp settings.fragment.json ~/.claude/settings.json
```

期待する結果：`~/.claude/settings.json` に `env.DISABLE_AUTOUPDATER = "1"` と `autoUpdatesChannel = "stable"` がある（`check.sh` が確認する）。

### 5.4 手動で動作確認

```bash
cd ~/workspace
claude remote-control --debug-file ~/Library/Logs/claude-rc.log
```

launchd からは `mac/launchd/claude-rc.sh`（ラッパー）経由で同じコマンドが起動される。ラッパーは `~/.config/agentstation/session.json` があれば `--session-id` を付ける（`session_restore` 用。要確認 verify.md C-2）。

期待する結果：スマホの Claude アプリ（その環境のアカウント）にセッションが出る。Ctrl+C で止める。ログの文言（接続成功・失敗）は **要確認 verify.md C-3**（エージェントの状態判定に使う）。

---

## 6. エージェント（host / vm1 / vm2 それぞれで）

### 6.1 取得とビルド

plist が参照するパスは `~/workspace/agentstation`。ここに clone する。各環境の git 認証はその環境のものを使い、他の環境の鍵を持ち込まない（spec 3.1）。

```bash
mkdir -p ~/workspace
cd ~/workspace
git clone <リポジトリの URL> agentstation
cd agentstation
npm install
npm run build --workspace agent
ls -l agent/dist/index.js
```

期待する結果：`agent/dist/index.js` が 1 ファイルできる。

### 6.2 設定ファイル（`agent/src/config.ts` が正。キーが増えたら `agent/README.md` を参照）

```bash
mkdir -p ~/.config/agentstation
chmod 700 ~/.config/agentstation
```

`~/.config/agentstation/config.json`（秘密情報は入れない）。host の例：

```json
{
  "base_url": "https://workstation.example.com",
  "claude_path": "/Users/taro/.local/bin/claude",
  "tart_path": "/opt/homebrew/bin/tart",
  "work_dir": "/Users/taro/workspace",
  "rc_debug_log": "/Users/taro/Library/Logs/claude-rc.log"
}
```

vm1 の例（`tart_path` は不要。`claude_path` などはそのユーザーのパス）：

```json
{
  "base_url": "https://workstation.example.com",
  "claude_path": "/Users/hanako/.local/bin/claude",
  "work_dir": "/Users/hanako/workspace",
  "rc_debug_log": "/Users/hanako/Library/Logs/claude-rc.log"
}
```

| キー | 必須 | 意味（config.ts のコメントより） |
| --- | --- | --- |
| `base_url` | 必須 | ダッシュボードの URL |
| `claude_path` | 必須（絶対パス） | `claude` の場所 |
| `tart_path` | host だけ必須 | `tart` の場所 |
| （`session.json`） | エージェントが書く | `session_restore` のとき `{"session_id": "..."}` を書き、`claude-rc.sh` が読んで消す |
| `work_dir` | 任意（既定 `~/work/rc`。実機は `~/workspace`） | Remote Control の作業フォルダ |
| `rc_debug_log` | 任意（既定 `~/Library/Logs/claude-rc.log`） | `--debug-file` のパス |
| `labels` | 任意 | launchd のラベル。既定は `com.example.claude-rc`、`com.example.codex`、`com.example.tart-vm1`、`com.example.tart-vm2`（`mac/launchd/` と一致） |
| `vm_plists` / `vm_names` / `tart_vms_dir` | 任意 | 既定どおりなら書かない |
| `vm_ips` | 任意（host） | VM の固定 IP（`{"vm1":"192.168.64.10","vm2":"192.168.64.11"}`）。あれば `tart ip` より優先。IP 変更直後は ARP に旧 IP が残るため、静的 IP にしたら書く |
| `interval_ms` | 任意（既定 60000） | 報告間隔 |

Codex の常駐が無い環境では `"labels": { "codex": null }` を書く（`codex.state` が `unknown` になる）。

`~/.config/agentstation/token.json`（**秘密**。Access のサービストークン。環境ごとに別。発行は `cloudflare/access/setup.md` 3章）：

```json
{ "client_id": "<この環境のトークンの Client ID>", "client_secret": "<この環境の Client Secret>" }
```

```bash
chmod 600 ~/.config/agentstation/token.json
ls -l ~/.config/agentstation/
```

期待する結果：`token.json` が `-rw-------`。エージェントは起動時に権限が広いと警告する。`session.json` と `state.json` はエージェントが同じフォルダに作る。

### 6.3 手動で起動確認

```bash
cd ~/workspace/agentstation/agent
~/.nodebrew/current/bin/node dist/index.js --env=host
```

期待する結果：起動のログ行が出て、設定エラー（`設定 base_url がない` など）で落ちない。Ctrl+C（SIGINT）で実行中の操作を待ってから止まる。VM では `--env=vm1` / `--env=vm2`。ログの形式は `agent/README.md` を参照。

### 6.4 plist の配置

`mac/launchd/README.md` の `sed` の例に従って置く。起動は 8 章でまとめて行う。

```bash
cd ~/workspace/agentstation/mac/launchd
mkdir -p ~/Library/LaunchAgents ~/Library/Logs/agentstation
sed -e "s/__USER__/$(whoami)/g" -e "s/__ENV__/host/g" com.example.agent.plist > ~/Library/LaunchAgents/com.example.agent.plist
plutil -lint ~/Library/LaunchAgents/com.example.agent.plist
```

---

## 7. cloudflared（host だけ）

設定ファイルの中身（Tunnel の作成、`config.yml`、credentials の置き場）は `cloudflare/cloudflared/setup.md` と `cloudflare/cloudflared/config.yml.example` を参照する。ここでは置き場と LaunchDaemon だけ（同 setup.md の 8a と同じ手順）。

| 物 | 置き場 | 権限 |
| --- | --- | --- |
| `config.yml` | `/etc/cloudflared/config.yml` | root:wheel 644 |
| Tunnel の credentials（JSON）・cert.pem | `/etc/cloudflared/`（**秘密**。リポジトリに入れない） | root:wheel 600 |
| plist | `/Library/LaunchDaemons/com.cloudflare.cloudflared.plist` | root:wheel 644 |
| ログ | `/Library/Logs/cloudflared/` | ー |

```bash
sudo mkdir -p /etc/cloudflared /Library/Logs/cloudflared
sudo cloudflared tunnel --config /etc/cloudflared/config.yml ingress validate
cd ~/workspace/agentstation/mac/launchd
sudo install -m 0644 -o root -g wheel com.cloudflare.cloudflared.plist /Library/LaunchDaemons/com.cloudflare.cloudflared.plist
sudo launchctl bootstrap system /Library/LaunchDaemons/com.cloudflare.cloudflared.plist
sudo launchctl print system/com.cloudflare.cloudflared | grep -E "state|pid"
tail -20 /Library/Logs/cloudflared/cloudflared.err.log
```

期待する結果：`ingress validate` が OK、`state = running`、ログに `Registered tunnel connection` の行が出る（文言は要確認）。`cloudflared service install` を使った場合との違いは `mac/launchd/README.md`。

---

## 8. launchd の配置と起動順、動作確認

### 8.1 起動順（spec 3.1）

```
電源投入 → cloudflared（LaunchDaemon、ログイン前）→ 自動ログイン → [エージェント(host)、tart-vm1、tart-vm2、claude-rc] が同時に起動
VM の中：ゲストの自動ログイン → [エージェント(vm)、claude-rc]
```

LaunchAgent 同士の順序は launchd が保証しないので、各プロセスは他が居なくても落ちない作りになっている（エージェントは Cloudflare 不達なら次回に回す。VM の起動完了まで 1〜2 分は「起動中」扱い）。

### 8.2 host に置くもの

```bash
cd ~/workspace/agentstation/mac/launchd
mkdir -p ~/Library/LaunchAgents ~/Library/Logs/agentstation ~/Library/Logs/agentstation-vm ~/workspace
sed -e "s/__USER__/$(whoami)/g" -e "s/__ENV__/host/g" com.example.agent.plist > ~/Library/LaunchAgents/com.example.agent.plist
sed -e "s/__USER__/$(whoami)/g" com.example.claude-rc.plist > ~/Library/LaunchAgents/com.example.claude-rc.plist
sed -e "s/__USER__/$(whoami)/g" com.example.tart-vm1.plist > ~/Library/LaunchAgents/com.example.tart-vm1.plist
sed -e "s/__USER__/$(whoami)/g" com.example.tart-vm2.plist > ~/Library/LaunchAgents/com.example.tart-vm2.plist
plutil -lint ~/Library/LaunchAgents/com.example.*.plist
grep -l "__" ~/Library/LaunchAgents/com.example.*.plist || echo "置換漏れなし"
```

手動で起動していた `tart run` / `claude remote-control` / `node dist/index.js` が残っていれば先に止める。

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.example.agent.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.example.tart-vm1.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.example.tart-vm2.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.example.claude-rc.plist
```

### 8.3 vm1 / vm2 に置くもの（ゲストの中で、そのユーザーで）

```bash
cd ~/workspace/agentstation/mac/launchd
mkdir -p ~/Library/LaunchAgents ~/Library/Logs/agentstation ~/workspace
sed -e "s/__USER__/$(whoami)/g" -e "s/__ENV__/vm1/g" com.example.agent.plist > ~/Library/LaunchAgents/com.example.agent.plist
sed -e "s/__USER__/$(whoami)/g" com.example.claude-rc.plist > ~/Library/LaunchAgents/com.example.claude-rc.plist
plutil -lint ~/Library/LaunchAgents/com.example.*.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.example.agent.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.example.claude-rc.plist
```

vm2 は `--env=vm2`。

Codex の plist（`com.example.codex.plist`）は常駐できることが分かるまで置かない（要確認 verify.md C-5）。

### 8.4 動作確認

```bash
launchctl print gui/$(id -u)/com.example.agent | grep -E "state|pid"
launchctl print gui/$(id -u)/com.example.claude-rc | grep -E "state|pid"
launchctl print gui/$(id -u)/com.example.tart-vm1 | grep -E "state|pid"
launchctl print gui/$(id -u)/com.example.tart-vm2 | grep -E "state|pid"
tail -20 ~/Library/Logs/agentstation/err.log
tail -20 ~/Library/Logs/claude-rc.err.log
tart list
```

期待する結果：

- 4 つとも `state = running`（VM 内は 2 つ）
- `claude-rc.err.log` に `Workspace not trusted` やキーチェーンのエラーが無い（要確認 verify.md C-1）
- `tart list` で vm1 / vm2 が `running`。2 分以内に `tart ip vm1` が返る
- スマホの Claude アプリで、3 アカウントそれぞれにセッションが見える
- ダッシュボード `https://workstation.example.com` の一覧に 3 環境が「正常」で出て、「最終受信」が 1 分以内で更新される（Worker 側の配備が済んでいる場合）

まとめて確認：

```bash
bash ~/workspace/agentstation/mac/scripts/check.sh
```

期待する結果：`NG 0`。`要確認` の項目は目で確かめる。

### 8.5 止め方・やり直し方

```bash
launchctl bootout gui/$(id -u)/com.example.claude-rc
launchctl kickstart -k gui/$(id -u)/com.example.claude-rc
```

plist を書き換えたら `bootout` → `bootstrap`。`kickstart -k` は再起動だけで plist は読み直さない。

---

## 9. ログローテーション、sudoers、sshd

### 9.1 newsyslog（host / vm1 / vm2）

```bash
cd ~/workspace/agentstation/mac/newsyslog.d
sed "s/__USER__/$(whoami)/g" agentstation.conf > /tmp/agentstation.conf
sudo install -m 0644 -o root -g wheel /tmp/agentstation.conf /etc/newsyslog.d/agentstation.conf
sudo newsyslog -nvv
```

VM では `agentstation.conf` の「host だけ」の行（cloudflared と agentstation-vm）を消してから置く。

期待する結果：`newsyslog -nvv` に対象のファイルが列挙され、エラーが無い。50MB を超えたファイルが 30 分以内に `.0.bz2` に回る。開いたままのプロセスは次の再起動から新しいファイルに書く（`agentstation.conf` の注意書き。要確認）。

### 9.2 sudoers（host だけ。spec 6章）

`host_restart` のためにエージェントが `sudo /sbin/shutdown -r now` を呼ぶ。許可するのはこの 1 つだけ。cloudflared の再起動は Taro が手動で行うので入れない。

```bash
cd ~/workspace/agentstation/mac/sudoers.d
sed "s/__USER__/$(whoami)/g" agentstation > /tmp/agentstation
sudo visudo -cf /tmp/agentstation
sudo install -m 0440 -o root -g wheel /tmp/agentstation /etc/sudoers.d/agentstation
rm /tmp/agentstation
sudo -n -l /sbin/shutdown -r now
```

期待する結果：`parsed OK`、最後の行に `/sbin/shutdown -r now` が出る（パスワードを聞かれない）。`/etc/sudoers` が `#includedir /etc/sudoers.d` を含むこと（要確認：`sudo grep includedir /etc/sudoers`）。

### 9.3 sshd（host / vm1 / vm2。Access の SSH CA）

`ca.pub`（Cloudflare Zero Trust の SSH CA 公開鍵）の取り方は `cloudflare/access/setup.md` 5章。経路 A（ブラウザ版 SSH。アプリごとの CA：host は ssh-host 用、vm1 は ssh-vm1 用）と経路 B（WARP。Gateway SSH CA）で CA が別物なので、各マシンの `ca.pub` に 2 行（1 行 1 鍵）書く。実際に証明書で入れるかは要確認（verify.md D-5 / spec 8.2）。

```bash
sudo install -m 0644 -o root -g wheel ca.pub /etc/ssh/ca.pub
cd ~/workspace/agentstation/mac/sshd
sudo install -m 0644 -o root -g wheel 50-cloudflare-access.conf /etc/ssh/sshd_config.d/50-cloudflare-access.conf
grep Include /etc/ssh/sshd_config
sudo sshd -t
```

期待する結果：`Include /etc/ssh/sshd_config.d/*` があり、`sshd -t` が何も出さない。macOS の sshd は接続ごとに launchd が起動するので再起動は不要の見込み（要確認。読み直さなければ `sudo launchctl kickstart -k system/com.openssh.sshd`。SSH で入ったまま実行すると切れる）。

**順番に注意**：断片の末尾 `PasswordAuthentication no` と `KbdInteractiveAuthentication no` は最初はコメントアウトしてある。ブラウザ版 SSH（`ssh-host.example.com`）で証明書ログインできることを確認してから `sudo vi /etc/ssh/sshd_config.d/50-cloudflare-access.conf` でコメントを外し、`sudo sshd -t` で確認する。先に切って入れなくなったら画面共有か実機で戻す。鍵交換方式はブラウザ版が使う `curve25519-sha256` などが macOS の sshd の既定に含まれるので通常は変更不要（`cloudflare/access/setup.md` 4章）。通らなければ断片に `KexAlgorithms` を足す。

---

## 10. 再起動と電源断の試験

### 10.1 再起動

```bash
sudo shutdown -r now
```

5 分待ってから、別の端末で：

```bash
ssh taro@<Mac mini の LAN IP> "uptime; launchctl print gui/\$(id -u)/com.example.agent | grep state; tart list"
```

期待する結果：ログイン画面を経ずに戻り、エージェント・VM・Remote Control が `running`。スマホで 3 環境のセッションが見え、ダッシュボードが 3 環境「正常」になる（フェーズ2の完了条件）。

### 10.2 電源断（スマートプラグ。spec 6.1）

製品は SwitchBot プラグミニ（JP）。設置：

1. SwitchBot アプリ（Taro の既存アカウント）で「デバイスを追加」→ プラグミニ。Wi‑Fi は自宅ルーターの **2.4GHz** の SSID
2. 機器名を付ける（2026-11-01 時点は「Mac mini」）。停電から戻ったときの動作を決める設定項目はアプリに無い（Taro 確認）ので、下の試験 4 で確かめる
3. Mac mini の電源ケーブルをプラグに挿す（Mac は一度落ちるので、作業中のものが無いときに）
4. ダッシュボード連携（`cloudflare/worker/setup.md` 4-5）：アプリの プロフィール › 設定 › アプリバージョンを 10 回タップ → 開発者オプション → token と secret を取り、`wrangler secret put SWITCHBOT_TOKEN` / `SWITCHBOT_SECRET`。機器 ID（アプリの機器の設定、または `GET /v1.1/devices`）を `worker/wrangler.toml` の `SWITCHBOT_PLUG_DEVICE_ID` に入れてデプロイ
5. 一覧の見出しに「電源プラグ オン · nnW」が出ることを確認（1〜2 分）

試験（Mac で作業中のものが無いことを確認してから）：

1. host のエージェントを止める（`launchctl bootout gui/$(id -u)/com.example.agent`）か、Mac の有線 LAN を抜いて、一覧が「応答なし」になるまで 10 分待つ（ボタンはそれまで押せない）
2. ダッシュボードの Taro の環境 › 操作 › **電源を入れ直す** → ホスト名 `host` を入力 → 1 分の猶予 → プラグがオフ → 約 1 分でオン
3. 3〜5 分待つ
4. **停電の模擬**：戻ったら、プラグ本体をコンセントから抜いて 30 秒後に差し直す。プラグがオンで戻り（一覧の「電源プラグ」がオン、またはアプリ）、Mac が起動すること。オフのまま戻るなら、本当の停電のあと Mac が上がらないので、プラグの使い方を見直す（spec 11章）

期待する結果：10.1 と同じ状態に戻る（要確認 verify.md A-4）。操作履歴に「電源を入れ直す / 完了（ダッシュボード）」。戻ったら `tart list` と VM 内の起動を確認する（強制電源断はディスク破損の可能性がある）。`autorestartatconnect 1`（自動的に起動：常に）・自動ログイン・launchd の 3 つが揃っていないと戻らない。アプリからの オフ → 30 秒 → オン でも同じ試験ができる。

ルーターや回線が落ちているときはスマートプラグ自体に届かない（一覧に「届かない」と出る。別経路で考える）。

---

## 11. 更新手順

### 11.1 エージェント（`agent_update` は作らない。決定）

リポジトリに remote は無い。host の `~/workspace/agentstation` が正本で、VM へは rsync で配る（`.git` ごと。初回は `docs/initial-setup.md` と同じ）。host で変更をコミットしてから：

```bash
# host から vm1 / vm2 へ（node_modules・dist・秘密は送らない。--delete でも除外したものは消えない）
for t in hanako@192.168.64.10 jiro@192.168.64.11; do
  rsync -az --delete --exclude node_modules --exclude dist --exclude .wrangler --exclude '.dev.vars*' --exclude .DS_Store \
    ~/workspace/agentstation "$t":workspace/
  ssh "$t" 'export PATH=$HOME/.nodebrew/current/bin:$PATH; cd ~/workspace/agentstation && npm run build --workspace agent && launchctl kickstart -k gui/$(id -u)/com.example.agent && sleep 3 && launchctl print gui/$(id -u)/com.example.agent | grep -E "^\s*(state|pid) "'
done
```

依存（`package.json` / `package-lock.json`）を変えたときだけ、ビルドの前に `npm install` を足す。host は `npm run build --workspace agent` のあと同じく `launchctl kickstart -k gui/$(id -u)/com.example.agent`（host でフォルダごとの RC から作業していると、その Claude のセッションも一緒に切れる。エージェントの子プロセスのため）。

期待する結果：`state = running`、`~/Library/Logs/agentstation/out.log` に新しい「agentstation 起動」の行。plist を変えたときは `bootout` → `bootstrap`。

### 11.2 Claude Code

夜間メンテナンス（04:00 / 04:20 / 04:40 JST。spec 7章）でエージェントが `claude update` → Remote Control 再起動を行う。手動でやる場合：

```bash
claude update
launchctl kickstart -k gui/$(id -u)/com.example.claude-rc
```

### 11.3 サービストークンの更新（spec 9章）

`cloudflare/access/setup.md` 3章の手順で新しいトークンを発行し、その環境の `~/.config/agentstation/token.json` を書き換えて `chmod 600`、`launchctl kickstart -k gui/$(id -u)/com.example.agent`。古いトークンは Cloudflare 側で失効する。VM が乗っ取られた疑いがあればその VM のトークンだけ失効する。

### 11.4 macOS・Tart・cloudflared・Homebrew

Taro が手動で、計画的に（自動更新はオフ）。

```bash
brew upgrade cloudflared
sudo launchctl kickstart -k system/com.cloudflare.cloudflared
```

Tart の更新は VM を止めてから（`brew upgrade tart`）。macOS の更新は `host_restart` と同じ扱い（VM を止めてから再起動）。

---

## 12. やってはいけないこと

| してはいけないこと | 理由 |
| --- | --- |
| GUI セッションからログアウトする（画面共有で入ったときも「ログアウト」を押さない） | LaunchAgent がすべて止まる。再起動が必要なら `host_restart` |
| FileVault をオンにする | 自動ログインが使えなくなり、電源断から無人で戻れない |
| macOS / App Store / Homebrew / Claude Code の自動更新をオンにする | 勝手な再起動・更新で Remote Control が落ちる |
| 作業フォルダをホーム直下・Desktop・Documents にする | 信頼設定が保存されず `Workspace not trusted` で止まる／iCloud で場所が変わる |
| 他の環境の鍵・トークン・認証情報を置く | 環境の分離が崩れる。サービストークンは環境ごとに別 |
| `claude remote-control` に `--no-create-session-in-dir` を付ける | セッションが復元できなくなる |
| 自宅ルーターのポートを開ける | すべて外向き接続で成り立つ設計（CLAUDE.md 1） |
| sudoers に `shutdown -r now` 以外を足す | エージェントに与える権限はこの 1 つだけ |
| トークン・パスワードをログやダッシュボードに出す | CLAUDE.md 3 |

---

## 付録 A. VM ゲスト用チェックリスト（vm1 / vm2 の中で、そのユーザーで）

| # | 項目 | コマンド / 画面 | 期待する結果 |
| --- | --- | --- | --- |
| 1 | ユーザー名 | `whoami` | `hanako` / `jiro` |
| 2 | 自動ログイン | システム設定 › ユーザとグループ › 自動ログイン | そのユーザー |
| 3 | FileVault | `fdesetup status` | `Off`（VM 内では通常オフ） |
| 4 | pmset | `bash mac/scripts/pmset-setup.sh` | `sleep 0`、`disksleep 0`（`autorestartatconnect` / `womp` が無くてもよい。要確認 B-5） |
| 5 | 自動更新オフ | 2.5 と同じ | `softwareupdate --schedule` が off |
| 6 | タイムゾーン | 2.7 と同じ | `Asia/Tokyo` |
| 7 | リモートログイン・画面共有 | 2.8 と同じ（VNC パスワード方式） | 22 / 5900 が開く |
| 8 | IP 固定 | 4.3 | 再起動しても同じ IP |
| 9 | Cloudflare への HTTPS | 4.5 | `200` |
| 10 | ツール | Homebrew、nodebrew＋Node 24、Claude Code、Codex | 3 章と同じ絶対パス |
| 11 | Claude | 5 章（アカウント B / C でログイン、`~/workspace` を信頼、settings.json） | 5.4 でスマホに出る |
| 12 | エージェント | 6 章（`--env=vm1` / `vm2`、その VM のトークン） | 6.3 で起動する |
| 13 | launchd | 8.3 | `check.sh` で NG 0 |
| 14 | newsyslog・sshd | 9.1、9.3（sudoers は不要） | ー |
| 15 | 置かないもの | host の鍵、他 VM のトークン、Tart、cloudflared | ー |

VM の再起動で全部戻ることを `tart stop vm1` → launchd の再起動 → 2 分後にスマホとダッシュボードで確認する。
