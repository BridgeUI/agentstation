# 実機での事前確認（確認表）

設計を左右する前提を、導入先の Mac mini で確かめるための表。項目番号（A-1、B-2 など）はコードのコメントや手順書から参照されている。元の構成では全項目を確かめたうえで `docs/initial-setup.md` の手順が確定している。導入するときも、オーナーが確かめ、結果を各項目の「結果」に書く。設計を左右する項目（★）を先に。
コマンドは Mac mini 上のターミナルで実行する。出力はそのまま貼ってよいが、**メールアドレス・トークン・パスワードは伏せる**。

記入のしかた：`結果：` の行に「OK / NG / 条件つき」と、根拠になる出力や気づいたことを書く。

---

## A. Mac 本体

### A-1 ★ 機種・CPU・メモリ・ディスク・macOS

```bash
sysctl -n machdep.cpu.brand_string; sysctl -n hw.ncpu hw.perflevel0.physicalcpu hw.perflevel1.physicalcpu; sysctl -n hw.memsize | awk '{print $1/1024/1024/1024 " GB"}'; df -h /; sw_vers
```

期待：コア数（性能コア／効率コア）、24GB、512GB、macOS のバージョンが分かる。`docs/spec.md` 3.3 の配分（VM 4コア×2）が妥当か判断する。

結果：

### A-2 ★ FileVault をオフにして自動ログインを有効にする（決定済み）

```bash
fdesetup status
```

`FileVault is On.` なら、システム設定 › プライバシーとセキュリティ › FileVault でオフにする（または `sudo fdesetup disable`）。完了後：

```bash
fdesetup status
```

次にシステム設定 › ユーザとグループ › 自動ログイン でオーナーのアカウントを選ぶ。

期待：`FileVault is Off.`。自動ログインの選択肢が選べる（FileVault オンだと灰色で選べない）。再起動するとログイン画面を経ずにデスクトップまで進む。

結果：

### A-3 ★ スリープ禁止と停電後の自動起動

```bash
sudo pmset -a sleep 0 disksleep 0 displaysleep 10 autorestartatconnect 1 powernap 0 womp 1
pmset -g
```

期待：`sleep 0`、`disksleep 0`、`autorestartatconnect 1`、`powernap 0` が表示される。システム設定 › エネルギー で「ディスプレイがオフのときに自動でスリープさせない」がオン、「自動的に起動」が常に。

24 時間放置したあと：

```bash
pmset -g log | grep -E "Sleep|Wake" | tail -20
uptime
```

期待：`Entering Sleep` が出ていない。`uptime` が途切れていない。

結果：

### A-4 ★ スマートプラグでの電源断→自動復帰

スマートプラグ（SwitchBot プラグミニ）を設置し、A-2・A-3 のあとで試す。Mac で作業中のものが無いことを確認してから。手順は `docs/setup-mac.md` 10.2。

1. 一覧が「応答なし」になるまで 10 分待ってから、ダッシュボードの「電源を入れ直す」（または SwitchBot アプリからオフ → 30 秒 → オン）
2. 3〜5 分待つ

期待：Mac が自動で起動し、ログイン画面を経ずにデスクトップまで進む。`uptime` が短くなっている。（エージェントと VM の自動起動はフェーズ2で確認）

あわせて確認（`docs/spec.md` 11章の SwitchBot の項）：API 側の確認ポイント（`power` が入る、`weight` は現在の W で Mac のアイドル時 約 4 W、署名は base64 のまま通る）。残りは、プラグ本体を抜き差しして（停電の模擬）オンで戻るか。アプリに設定項目は無い。

結果：

### A-5 macOS の自動更新をオフにする

システム設定 › 一般 › ソフトウェアアップデート › 自動アップデート（ⓘ）で「macOS アップデートをインストール」をオフ。あわせて：

```bash
sudo softwareupdate --schedule off
softwareupdate --schedule
```

期待：`Automatic checking for updates is turned off`。

結果：

### A-6 ネットワーク

- 有線 LAN でつながっているか（システム設定 › ネットワーク）
- ルーターで Mac mini の LAN IP を固定（DHCP 予約）したか
- 家庭の LAN のアドレス帯（例：`192.168.1.0/24`）。`192.168.64.0/24` と重なっていないこと

結果：

---

## B. Tart（VM）

### B-1 ★ VM の作成と `--no-graphics` 起動、IP の安定性

```bash
brew install cirruslabs/cli/tart
tart clone ghcr.io/cirruslabs/macos-sequoia-base:latest vm1   # 使うイメージは手元の判断で
tart set vm1 --cpu 4 --memory 6144 --disk-size 90
tart run --no-graphics vm1 &
sleep 90; tart ip vm1; tart list
```

VM を 3 回ほど停止→起動（`tart stop vm1` → `tart run --no-graphics vm1 &`）して、そのたびに `tart ip vm1` を記録する。

期待：IP が毎回同じか。同じでも「保証はない」ので、B-2 でいずれかの方法で固定する。

結果：

### B-2 ★ VM の IP の固定（どちらかが通ればよい）

(a) ゲスト内で静的 IP：ゲストの システム設定 › ネットワーク で、IP `192.168.64.10`、サブネット `255.255.255.0`、ルーター `192.168.64.1`、DNS `192.168.64.1` を手動設定。ホストから：

```bash
ping -c 3 192.168.64.10
ssh hanako@192.168.64.10 uptime
```

(b) ブリッジ：`tart run --no-graphics --net-bridged=en0 vm1` で起動し、ルーターの DHCP 予約で固定。

期待：VM を再起動しても同じ IP で SSH できる。どちらを採用したかを書く。

結果：

### B-3 ★ ホストの `192.168.64.1` に SSH で届くか

VM が 1 台でも動いている状態で、ホスト自身から：

```bash
ifconfig | grep -A3 bridge100
ssh taro@192.168.64.1 uptime
```

期待：`bridge100` に `192.168.64.1` が付いていて、SSH が通る（WARP 経由の内部 IP を `192.168.64.0/24` に揃えるため）。

結果：

### B-4 VM ごとの仮想化プロセスを特定できるか

```bash
ps aux | grep -i -E "tart|Virtualization" | grep -v grep
```

期待：vm1 と vm2 それぞれの `tart run` プロセス（または子プロセス）が区別でき、CPU%・RSS が取れる。プロセス名に VM 名が入っているか、親プロセスからたどれるかを書く。

結果：

### B-5 ★ ゲスト内の設定（自動ログイン・スリープ禁止・自動更新オフ・画面共有）

ゲストの中で A-2（FileVault は VM 内では通常オフ）、A-3、A-5 を行い、システム設定 › 一般 › 共有 で「リモートログイン」と「画面共有」をオン。画面共有の ⓘ で「VNC ビューアがパスワードで画面を制御することを許可」をオンにし、VNC パスワードを設定する（パスワードマネージャーに保存）。

ホストから：

```bash
ssh hanako@<vm1のIP> "pmset -g | grep -E ' sleep|disksleep'; fdesetup status"
nc -vz <vm1のIP> 5900
```

さらに、Mac の「画面共有」アプリで `vnc://<vm1のIP>` に接続する。

期待：`sleep 0`。5900 が開いている。画面共有で `--no-graphics` の VM のデスクトップが見える。

結果：

### B-6 ★ VM 内から Cloudflare へ HTTPS が通るか（エージェントを VM に置くため）

ゲストの中で：

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://www.cloudflare.com/
```

期待：`200`（NAT 越しに外へ出られる）。

結果：

---

## C. Claude Code / Remote Control

### C-1 ★ launchd から `claude remote-control` を起動できるか

1. 作業フォルダを作る（ホーム直下・Desktop・Documents は避ける。例：`~/work/rc`）
2. そのフォルダで一度 `claude` を対話的に起動し、信頼の質問に答えて終了する
3. `which claude` で絶対パスを控える
4. 次の plist を `~/Library/LaunchAgents/co.bridgeui.agentstation.claude-rc.plist` に置く（パスと `<ユーザー名>` を置き換える）

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>co.bridgeui.agentstation.claude-rc</string>
  <key>ProgramArguments</key><array>
    <string>/Users/<ユーザー名>/.local/bin/claude</string>
    <string>remote-control</string>
    <string>--debug-file</string>
    <string>/Users/<ユーザー名>/Library/Logs/claude-rc.log</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/<ユーザー名>/work/rc</string>
  <key>EnvironmentVariables</key><dict>
    <key>HOME</key><string>/Users/<ユーザー名></string>
    <key>PATH</key><string>/Users/<ユーザー名>/.local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    <key>LANG</key><string>en_US.UTF-8</string>
  </dict>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>/Users/<ユーザー名>/Library/Logs/claude-rc.out.log</string>
  <key>StandardErrorPath</key><string>/Users/<ユーザー名>/Library/Logs/claude-rc.err.log</string>
</dict></plist>
```

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/co.bridgeui.agentstation.claude-rc.plist
launchctl print gui/$(id -u)/co.bridgeui.agentstation.claude-rc | grep -E "state|pid"
tail -50 ~/Library/Logs/claude-rc.err.log
```

期待：`state = running`。スマホの Claude アプリ（その環境のアカウント）にセッションが出る。`Workspace not trusted` やキーチェーン関連のエラーが出ない。

結果：

### C-2 ★ 停止→再起動でセッションが戻るか。セッション ID とタイトルの取り方

```bash
launchctl kickstart -k gui/$(id -u)/co.bridgeui.agentstation.claude-rc
```

期待：スマホで同じセッションが続いている（停止から約 4 時間以内）。あわせて、セッション ID とタイトルがどこで分かるかを書く（`claude remote-control --help` の出力、ログの行、`~/.claude/` 配下のファイル名など。**ファイル名やタイトル本文はここに貼らず、形だけ書く**）。

結果：

### C-3 ★ ログに出る接続成功・失敗の文言、「作業中」の判定材料

`~/Library/Logs/claude-rc.log` を見て、次を書く（本文は貼らず、文言の形だけ）：

- 接続できたときの行
- 回線を切った（Wi‑Fi オフなど）ときの行と、戻したときの行
- ログアウト状態（`claude auth logout` 後）で起動したときの行
- スマホから作業させている間、ログやプロセスの CPU で「作業中」と分かる材料があるか

結果：

### C-4 ★ 各アカウント（A/B/C）で Remote Control が使えるか

3 つのアカウントそれぞれで C-1 を試し、スマホのアプリからセッションが見えるか。Team プランなら組織の設定で Remote Control が有効か。

結果：

### C-5 Codex CLI の常駐

各環境に Codex CLI を入れ、`codex --help` に常駐向けの機能（remote など）があるか。ChatGPT アプリから接続できるか。

結果：

---

## D. Cloudflare・Slack

### D-1 ★ example.com の DNS が Cloudflare にあるか

Cloudflare ダッシュボード › Websites に `example.com` があり、ネームサーバーが Cloudflare になっているか。

結果：

### D-2 ★ Google を Access の IdP に登録できるか

Cloudflare Zero Trust › Integrations › Identity providers で Google を追加できるか（Google Cloud 側で OAuth クライアントを作る権限があるか）。チーム名（`<チーム名>.cloudflareaccess.com`）も控える。

結果：

### D-3 ★ Slack の Incoming Webhook

example の Slack で通知先チャンネルを決め、Incoming Webhook を作れるか。Webhook URL は `wrangler secret put SLACK_WEBHOOK_URL` で入れる（ここには書かない）。

結果：

### D-4 WARP の Split Tunnel

Zero Trust › Team & Resources › Devices › Device profiles › Split Tunnels が「Exclude」モードなら、`192.168.0.0/16` を外して `192.168.64.0/24` だけ通るようにできるか（既定の除外一覧に手を入れられるか）。

結果：

### D-5 画面共有が Cloudflare のブラウザ版 VNC で使えるか（フェーズ7で確認してもよい）

Tunnel の公開ホスト名 `vnc-host.example.com` → `tcp://localhost:5900` を作り、Access アプリでブラウザ表示（VNC）をオンにして接続する。

期待：ブラウザに Mac の画面が出る。VNC パスワードで入れる。

結果：

---
