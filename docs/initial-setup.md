# 初期構築の手順（実機で確定した版）

Mac mini（host）と VM 2 台（vm1 / vm2）を実際に構築して確定した手順。**新しく導入する・作り直す・VM を作り足すときはこの文書に従う。** 新しく導入するときの進め方（値の置き換えを含む）は `kit/START.md`。

- 詳細なコマンドや背景は `docs/setup-mac.md`（設計時の手順書）と `cloudflare/*/setup.md`。この文書と食い違うときは **この文書が正**
- 前提を実機で確かめるための確認表は `docs/verify.md`
- 利用者（Hanako / Jiro）が自分でやることは `docs/onboarding.md`
- 壊れたときの直し方は `docs/runbook.md`
- 秘密情報（パスワード・トークン）はこの文書に書かない。置き場だけ 7 章に書く

## 0. 全体の流れ

| 段階 | やること | 誰が | 済んだかの確認 |
| --- | --- | --- | --- |
| 1 | Cloudflare（Zero Trust・Tunnel・WARP）の設定 | Taro（Claude が Chrome で操作） | `https://workstation.example.com/` に Google でログインできる |
| 2 | Worker と D1 のデプロイ、secret の登録 | Taro | `/api/health` が 200、`wrangler secret list` に 3 つ |
| 3 | host の基礎設定・ツール・常駐 | Taro（一部はシステム設定で手動） | ダッシュボードの Taro の環境で基礎設定が全部 OK |
| 4 | VM の作成と基礎設定（スクリプト 3 本） | Taro | Hanako / Jiro の環境に報告が届き、基礎設定が OK |
| 5 | 利用者の初期設定（Claude ログイン・Remote Control の同意） | Hanako / Jiro 本人 | ダッシュボードで Remote Control が「接続中」 |
| 6 | 復旧の試験（再起動・電源断） | Taro | `docs/runbook.md` 8 章に記録 |

所要時間の目安：1 が 2〜3 時間（初回のみ）、3 が 1〜2 時間、4 が VM 1 台あたり 20 分（ダウンロード込み）。

## 1. 前提（決定済み。`docs/spec.md` 13章）

- FileVault は **オフ**（自動ログインのため）。最後の復旧手段はスマートプラグ
- cloudflared は **LaunchDaemon**（root）。それ以外の常駐は利用者の LaunchAgent
- VM の IP は **ゲスト内で静的**：vm1 = `192.168.64.10`、vm2 = `192.168.64.11`、ゲートウェイ・DNS = `192.168.64.1`（Tart の NAT）
- macOS のユーザー名は Access のメールの @ より前：`taro` / `hanako` / `jiro`
- Remote Control の作業フォルダは **`~/workspace`**（全プロジェクトの親。ホーム直下は信頼が保存されない）
- オーナーは **Access 経由で VM に入らない**。VM の中の作業は host から構築用の鍵で行う（13章 #17）
- VNC パスワードは **ダッシュボードで表示する**（押したときだけ、本人・オーナーのみ。13章 #16）
- 通知は Slack（任意。Webhook を登録しなければ通知しない）

## 2. Cloudflare 側（作るものの一覧）

手順書：`cloudflare/access/setup.md`、`cloudflare/cloudflared/setup.md`、`cloudflare/warp/setup.md`、`cloudflare/worker/setup.md`。作るもの：

| 種類 | 名前 | 中身 |
| --- | --- | --- |
| Zero Trust のチーム | `example` | ログイン URL `example.cloudflareaccess.com` |
| IdP | Google | Google Cloud プロジェクト `example-access`（組織 example.com）の OAuth クライアント `cloudflare-access`。同意画面は「外部」（Gmail の人も入れる。Google Workspace の組織内だけで使うなら「内部」でもよい） |
| Access アプリ（Self-hosted） | `macmini-dashboard` | `workstation.example.com`。ポリシー「macmini members」（taro / hanako / jiro）。AUD は `worker/wrangler.toml` の `ACCESS_AUD_DASHBOARD` |
| Access アプリ（Self-hosted） | `macmini-agent-api` | `workstation.example.com/api/agent`。Service Auth。サービストークン `macmini-agent-host / vm1 / vm2`。AUD は `ACCESS_AUD_AGENT` |
| Access アプリ（SSH / VNC） | `ssh-host`, `vnc-host`, `ssh-vm1`, `vnc-vm1`, `ssh-vm2`, `vnc-vm2` | マシンごとの再利用ポリシー「macmini host users / vm1 users / vm2 users」 |
| SSH CA | ssh-host / ssh-vm1 / ssh-vm2 用 ＋ Infrastructure 用 | 公開鍵は `cloudflare/access/ca/`。各マシンの `/etc/ssh/ca.pub` は `ca.pub.host / .vm1 / .vm2` |
| Tunnel | `macmini` | 認証情報は host の `/etc/cloudflared/<UUID>.json`。ingress は `cloudflare/cloudflared/config.yml.example` と同じ。内部ネットワーク `192.168.64.0/24` をルート |
| WARP | 端末登録ポリシー「macmini members」、Split Tunnel（Exclude から `192.168.64.0/24` を外す）、Gateway プロキシ TCP、Targets（host .1 / vm1 .10 / vm2 .11）、Infrastructure アプリ `macmini-ssh` | TLS 復号はオフ（クライアントに「証明書がない」警告が出るが実害なし） |

注意：サービストークンの JWT の `common_name` は **トークン名ではなく Client ID**。`AGENT_TOKEN_NAMES` には Client ID を入れる。

## 3. Worker と D1

```bash
cd ~/workspace/macmini-dashboard && npm ci
```

```bash
cd worker && npm run build:ui && npx wrangler d1 migrations apply macmini-dashboard --remote && npx wrangler deploy
```

secret（値はリポジトリに書かない。`wrangler secret put <名前>` に標準入力で渡す）：

| 名前 | 中身 | 状態 |
| --- | --- | --- |
| `AGENT_TOKEN_NAMES` | `{"host":"<Client ID>","vm1":"…","vm2":"…"}` | 必須 |
| `VNC_PASSWORDS_JSON` | `{"host":"…","vm1":"…","vm2":"…"}`（7 章のファイルから組み立てる） | 必須 |
| `SLACK_WEBHOOK_URL` | example の Slack の Incoming Webhook | 任意 |

`[vars]`（`MEMBERS_JSON`、`ACCESS_TEAM_DOMAIN`、AUD 2 つ、`TZ_DISPLAY`）は `worker/wrangler.toml` に書いてある。ローカル開発は `docs/dev.md`。

## 4. host（Mac mini 本体）

### 4.1 システム設定で手動（Full Disk Access が無いとコマンドでできないもの）

1. ユーザーは `taro`（管理者）。自動ログインを `taro` に
2. FileVault オフ（`fdesetup status` が Off）
3. 一般 › 共有：リモートログイン オン、画面共有 オン。画面共有 ⓘ で「VNC ビューアがパスワードで画面を制御することを許可」をオンにし、VNC パスワードを **7 章の `host-secrets` の値に合わせる**
4. ターミナル（または使うシェル）に Full Disk Access（`systemsetup -setremotelogin` などに必要）
5. 有線 LAN で接続。ルーターの DHCP 予約で LAN 側 IP を固定（家庭の LAN が `192.168.64.0/24` と重ならないこと）
6. HDMI ダミープラグ（任意）、スマートプラグ

### 4.2 コマンドでやるもの

```bash
sudo bash mac/scripts/pmset-setup.sh
```

```bash
for k in AutomaticCheckEnabled AutomaticDownload AutomaticallyInstallMacOSUpdates CriticalUpdateInstall ConfigDataInstall; do sudo defaults write /Library/Preferences/com.apple.SoftwareUpdate $k -bool false; done; sudo defaults write /Library/Preferences/com.apple.commerce AutoUpdate -bool false
```

```bash
sudo systemsetup -settimezone Asia/Tokyo && sudo systemsetup -setusingnetworktime on
```

```bash
mkdir -p ~/.tart ~/workspace && tmutil addexclusion ~/.tart
```

`softwareupdate --schedule off` は macOS 26 では効かないので `defaults` で止める。

### 4.3 ツール

| ツール | 入れ方 | 置き場（plist が参照する絶対パス） |
| --- | --- | --- |
| Homebrew | 公式スクリプト | `/opt/homebrew/bin/brew` |
| Node 24 | `brew install nodebrew` → `nodebrew setup` → `nodebrew install v24` → `nodebrew use v24` → `~/.zprofile` に PATH | `~/.nodebrew/current/bin/node` |
| Tart | **公式リリースの tart.app を `~/Applications/` に置く**（brew の formula が壊れていた）。`ln -s ~/Applications/tart.app/Contents/MacOS/tart ~/.local/bin/tart` | `~/Applications/tart.app/Contents/MacOS/tart` |
| cloudflared | `brew install cloudflared` | `/opt/homebrew/bin/cloudflared` |
| Claude Code | `curl -fsSL https://claude.ai/install.sh \| bash` | `~/.local/bin/claude` |
| Claude の設定 | `~/.claude/settings.json` に `{"env":{"DISABLE_AUTOUPDATER":"1"},"autoUpdatesChannel":"stable"}` | ー |

### 4.4 Claude のログインと初回の同意（一度だけ、対話で）

```bash
cd ~/workspace && claude auth login
```

作業フォルダ（`~/workspace`）の信頼と Remote Control の初回同意（「Enable Remote Control? (y/n)」の `y`）は、**エージェントが起動時に `~/.claude.json` に記録する**（2026-11-01 変更。spec 13章 #23）。手で `claude` や `claude remote-control` を起動する必要はない。エージェントより先に launchd の claude-rc が起動して「Workspace not trusted」や同意待ちで終了しても、KeepAlive で再起動を繰り返すうちにエージェントが記録して通る。

### 4.5 エージェント

```bash
cd ~/workspace/macmini-dashboard/agent && npm run build
```

`~/.config/macmini-agent/config.json`（600）。実機の値：

```json
{
  "base_url": "https://workstation.example.com",
  "claude_path": "/Users/taro/.local/bin/claude",
  "tart_path": "/Users/taro/Applications/tart.app/Contents/MacOS/tart",
  "work_dir": "/Users/taro/workspace",
  "rc_debug_log": "/Users/taro/Library/Logs/claude-rc.log",
  "labels": { "codex": null },
  "tart_vms_dir": "/Users/taro/.tart/vms",
  "vm_ips": { "vm1": "192.168.64.10", "vm2": "192.168.64.11" },
  "interval_ms": 60000
}
```

`~/.config/macmini-agent/token.json`（600）に host のサービストークン `{"client_id":"…","client_secret":"…"}`。VM 用のトークンは一時的に `tokens/vm1.json` などに置き、VM に配ったら消す。

### 4.6 launchd（LaunchAgent。`mac/launchd/` のテンプレートを `__USER__` 置換して `~/Library/LaunchAgents/` へ）

| ラベル | 中身 | 備考 |
| --- | --- | --- |
| `com.example.agent` | エージェント `--env=host` | ー |
| `com.example.claude-rc` | `claude-rc.sh` → `claude remote-control`。WorkingDirectory は `~/workspace` | 4.4 を先に |
| `com.example.tart-vm1` / `-vm2` | `tart run --no-graphics vmN` | **tart のパスをテンプレートの `/opt/homebrew/bin/tart` から実機の場所に置き換える**。VM を作ってから登録する（無い VM を KeepAlive で起動し続けると失敗ループ） |

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.example.agent.plist
```

### 4.7 cloudflared（LaunchDaemon）

`cloudflare/cloudflared/setup.md` のとおり。`/etc/cloudflared/config.yml`（ingress は vm1 → `192.168.64.10`、vm2 → `.11`）、`/Library/LaunchDaemons/com.cloudflare.cloudflared.plist`。

### 4.8 sudoers・newsyslog・sshd（sudo が要る。Taro がターミナルで）

```bash
sed 's/__USER__/taro/g' mac/sudoers.d/macmini-agent > /tmp/macmini-agent && sudo visudo -cf /tmp/macmini-agent && sudo install -m 0440 -o root -g wheel /tmp/macmini-agent /etc/sudoers.d/macmini-agent
```

```bash
sed 's/__USER__/taro/g' mac/newsyslog.d/macmini.conf > /tmp/macmini.conf && sudo install -m 0644 -o root -g wheel /tmp/macmini.conf /etc/newsyslog.d/macmini.conf
```

```bash
sudo install -m 0644 -o root -g wheel cloudflare/access/ca/ca.pub.host /etc/ssh/ca.pub && sudo install -m 0644 -o root -g wheel mac/sshd/50-cloudflare-access.conf /etc/ssh/sshd_config.d/50-cloudflare-access.conf && sudo sshd -t
```

`sshd -t` が「no hostkeys available」と言うときはリモートログインを一度もオンにしていない（4.1 の 3）。

### 4.9 確認

- `bash mac/scripts/check.sh` で NG が無い
- ダッシュボード（Taro の環境 › 基礎設定）が全部 OK。手動の項目（FileVault、自動ログイン、画面共有…）もエージェントが確かめて表示する
- `launchctl print gui/$(id -u)/com.example.claude-rc` が running、ダッシュボードの Remote Control が「接続中」

## 5. VM（vm1 = Hanako、vm2 = Jiro）

すべて host のターミナルから。画面は使わない（最後の 1 画面だけ画面共有で）。例は vm1。vm2 は `vm1→vm2`、`hanako→jiro`、`Hanako→Jiro`、`.10→.11` に読み替える。

### 5.1 作成と起動（Taro）

```bash
tart clone ghcr.io/cirruslabs/macos-tahoe-base:latest vm1 && tart set vm1 --cpu 4 --memory 6144 --disk-size 90
```

```bash
sed -e 's#__USER__#taro#g' -e 's#/opt/homebrew/bin/tart#/Users/taro/Applications/tart.app/Contents/MacOS/tart#' mac/launchd/com.example.tart-vm1.plist > ~/Library/LaunchAgents/com.example.tart-vm1.plist && launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.example.tart-vm1.plist
```

1〜2 分待って DHCP の IP を取る（最初は `192.168.64.2` のような番号）：

```bash
tart ip vm1
```

### 5.2 構築用の鍵を入れる（Taro。パスワードを聞かれる唯一の手順）

```bash
ssh-keyscan -t ed25519 <DHCP の IP> >> ~/.ssh/known_hosts
```

```bash
ssh-copy-id -i ~/.ssh/id_ed25519.pub admin@<DHCP の IP>
```

ベースイメージの既定ユーザーは `admin`、パスワードは `admin`、sudo はパスワード不要。**日本語入力をオフにしてから**打つ（`yes` が「い」になって失敗した）。この鍵は構築専用で、CLAUDE.md 5「SSH 鍵は登録しない」の例外。構築が終わったら外してよい。

### 5.3 秘密情報と資材の準備（Taro）

```bash
umask 077; S=~/.config/macmini-agent/vm1-secrets; [ -f $S ] || { echo "USER_PW=$(openssl rand -base64 18 | tr -d '/+=')"; echo "VNC_PW=$(openssl rand -base64 12 | tr -dc 'A-Za-z0-9' | head -c 8)"; } > $S
```

VNC パスワードは 8 文字まで（VNC の制限）。利用者のログインパスワードは本人に伝え、あとで本人が変えてもよい（変えたら 5.8 の注意）。

```bash
IP=<DHCP の IP>; scp ~/.config/macmini-agent/vm1-secrets admin@$IP:.vm-secrets && scp cloudflare/access/ca/ca.pub.vm1 admin@$IP:ca.pub && scp mac/sshd/50-cloudflare-access.conf admin@$IP:50-cloudflare-access.conf && sed -e 's/__USER__/hanako/g' -e '/^# ---- host だけ/,$d' mac/newsyslog.d/macmini.conf > /tmp/macmini-vm1.conf && scp /tmp/macmini-vm1.conf admin@$IP:macmini.conf && ssh admin@$IP 'chmod 600 ~/.vm-secrets'
```

### 5.4 stage1：利用者ユーザーと基礎設定（admin で）

```bash
ssh admin@<DHCP の IP> "GUEST_USER=hanako GUEST_FULLNAME=Hanako GUEST_ENV=vm1 HOST_PUBKEY='$(cat ~/.ssh/id_ed25519.pub)' bash -s" < mac/scripts/vm-guest-stage1.sh
```

やること：利用者（管理者）の作成、自動ログイン（`/etc/kcpassword` を直接生成）、設定アシスタントの完了済み記録のコピー、構築用の鍵、pmset、自動更新オフ、タイムゾーン、ホスト名、画面共有＋VNC パスワード、sshd の CA、newsyslog。終わると資材は消える。

### 5.5 stage2：Node・Claude・エージェント（利用者で）

```bash
IP=<DHCP の IP>; ssh hanako@$IP 'mkdir -p ~/workspace ~/.config/macmini-agent && chmod 700 ~/.config/macmini-agent' && rsync -az --delete --exclude node_modules --exclude dist --exclude .wrangler --exclude '.dev.vars*' --exclude .DS_Store ~/workspace/macmini-dashboard hanako@$IP:workspace/ && scp ~/.config/macmini-agent/tokens/vm1.json hanako@$IP:.config/macmini-agent/token.json && ssh hanako@$IP 'chmod 600 ~/.config/macmini-agent/token.json'
```

```bash
ssh hanako@<DHCP の IP> 'GUEST_ENV=vm1 bash -s' < mac/scripts/vm-guest-stage2.sh
```

やること：nodebrew と Node 24、Claude Code（ネイティブ版）と settings.json、エージェントのビルド、`config.json`、launchd の plist 2 つ。利用者がまだ GUI にログインしていないので launchd には載せない（再起動後の自動ログインで読み込まれる）。

### 5.6 stage3：IP の固定と再起動（admin で。接続が切れる）

```bash
ssh admin@<DHCP の IP> 'GUEST_IP=192.168.64.10 bash -s' < mac/scripts/vm-guest-stage3.sh
```

```bash
ssh-keygen -F <DHCP の IP> | grep -v '^#' | sed 's/^[^ ]* /192.168.64.10 /' >> ~/.ssh/known_hosts; sleep 8; ssh admin@192.168.64.10 'sudo shutdown -r now'
```

### 5.7 再起動後（Taro が確認 → 1 画面だけ手で）

2 分ほどでダッシュボードの Hanako の環境に報告が届く（Claude は「未ログイン」、基礎設定は OK）。画面には **設定アシスタントの「Update Mac Automatically」だけが残る**（macOS 26.6 ではキーで飛ばせない）。host の画面共有アプリで入り、「Only Download Automatically」→「Continue」：

```bash
open vnc://192.168.64.10
```

VNC パスワードはダッシュボードの Hanako の環境 › 接続 ›「パスワードを表示」。macOS のロック画面が出たら `hanako` の `USER_PW`。

host 側の後片付け：

```bash
rm ~/.config/macmini-agent/tokens/vm1.json
```

### 5.8 分かっていること（はまりどころ）

- **自動ログイン**：SSH 越しの `sysadminctl -autologin set` は `autoLoginUser` だけ書いて `/etc/kcpassword` を更新しない（error:22）。stage1 は kcpassword を直接生成する。**利用者がパスワードを変えると自動ログインが壊れる**ので、変えたら stage1 の該当部分（kcpassword の生成）をやり直す
- **`tart ip`**：静的 IP にすると DHCP リースに無いので「no IP address found」。`--resolver arp` なら引けるが、IP を変えた直後は旧 IP を返すことがある。エージェントは `config.json` の `vm_ips` を優先する
- **launchd**：利用者が GUI にログインしていないと `launchctl bootstrap gui/<uid>` は 125 で失敗する。再起動して自動ログインさせれば `~/Library/LaunchAgents` は自動で読み込まれる
- **設定アシスタント**：`defaults write com.apple.SetupAssistant …` を書いて `pkill` すると、ログアウトされてログインウインドウに戻る。殺さずに再起動する。admin の完了済み plist をコピーしても「Update Mac Automatically」は残る
- **Claude の認証**：SSH 越しの `claude auth status` はキーチェーンが見えず「未ログイン」と出る。ログアウトさせるときは GUI セッションの文脈で実行する（`sudo launchctl asuser <uid> sudo -u <user> -H claude auth logout`）
- **ブラウザ版 VNC**：カーソルが描画されないことがある。host の「画面共有」アプリなら描画される
- **zsh**：`ssh host "… $U:staff …"` のような `$var:` は zsh の修飾子と誤解されて「bad substitution」になる。`${U}` と書くか、スクリプトを `bash -s` で流す

### 5.9 ファイル共有（SMB。iPhone のファイルアプリ用）

利用者の `~/workspace` を SMB で共有する（`cloudflare/warp/setup.md` 6-5）。stage3 で IP が固定されたあと、host から：

```bash
scp mac/scripts/smb-workspace.sh admin@192.168.64.10:/tmp/
sed -n 's/^USER_PW=//p' ~/.config/macmini-agent/vm1-secrets | ssh admin@192.168.64.10 'sudo bash /tmp/smb-workspace.sh hanako; rm /tmp/smb-workspace.sh'
```

vm2 は `.11`、`vm2-secrets`、`jiro`。期待：`smbd が 445 で待受中`、`workspace` の共有。Gateway の 445 番のポリシーは作成済み（マシンごとに「その利用者と taro 以外」を遮断）。

## 6. 利用者の初期設定

`docs/onboarding.md` に利用者向けの言葉で書いてある。要点：画面共有で入る → 設定アシスタントを閉じる → `claude auth login`（自分のアカウント）。これだけで launchd の Remote Control が接続し、ダッシュボードが「接続中」になる（信頼と初回同意はエージェントが記録する。spec 13章 #23）。

## 7. 秘密情報の置き場

| もの | 置き場 | 備考 |
| --- | --- | --- |
| host のサービストークン | host `~/.config/macmini-agent/token.json`（600） | ー |
| VM のサービストークン | 各 VM の同じ場所。host の `tokens/` は配布後に削除 | ー |
| 利用者のログインパスワード・VNC パスワード | host `~/.config/macmini-agent/vm1-secrets`、`vm2-secrets`（600。`USER_PW=` と `VNC_PW=`） | 本人に伝える。チャットやダッシュボードには出さない（VNC だけは「パスワードを表示」で出す） |
| host の VNC パスワード | host `~/.config/macmini-agent/host-secrets`（600） | システム設定の画面共有で同じ値にする |
| VNC パスワード（画面表示用） | Worker の secret `VNC_PASSWORDS_JSON` | 上の 3 ファイルから組み立てて `wrangler secret put` |
| Tunnel の認証情報 | host `/etc/cloudflared/<UUID>.json`（root、600） | ー |
| Slack Webhook | Worker の secret `SLACK_WEBHOOK_URL` | 任意 |
| 構築用 SSH 鍵 | host `~/.ssh/id_ed25519`（VM の admin と利用者の authorized_keys に公開鍵） | 構築専用。終わったら外してよい |

## 8. 構築後の確認

- [ ] 一覧に 3 環境が並び、host は「正常」
- [ ] 各環境の基礎設定が全部 OK（host は 23 項目）
- [ ] 3 環境とも Remote Control が「接続中」（利用者の初期設定後）
- [ ] `ssh-host.example.com` のブラウザ版 SSH で taro が入れる。`vnc-vm1.example.com` で hanako の画面が見える
- [ ] `tart stop vm1` → launchd が起動し直し、2 分後に報告が戻る
- [ ] `launchctl kickstart -k gui/$(id -u)/com.example.agent` → 1 分後に報告が戻る
- [ ] フォルダごとの Remote Control：作成 → 起動 → 停止ができる

## 9. 構築後に残る作業

- Slack の Webhook（`SLACK_WEBHOOK_URL`）を使うなら登録する。手順は `cloudflare/worker/setup.md` 4 章（登録後は一覧の「Slack にテスト通知」で確認）
- host の画面共有の VNC パスワードを `host-secrets` の値に合わせる
- VM の `admin` ユーザーの無効化（利用者で入れることを確認したあと）
- sshd の `PasswordAuthentication no`（ブラウザ版 SSH の証明書ログインを確認してから）
- 24 時間スリープしないことの確認、スマートプラグによる電源断→復帰の試験、復旧訓練（`docs/runbook.md` 8 章）
- WARP クライアントに「証明書がない」警告が出るとき：Zero Trust の Gateway 証明書を生成して有効にする（TLS 復号がオフなら SSH / VNC には影響しない。新規生成は 24 時間に 3 枚まで）
