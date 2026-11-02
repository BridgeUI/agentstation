# cloudflared（Tunnel）の導入手順

host（Mac mini 本体）に cloudflared を LaunchDaemon（root）で常駐させ、公開ホスト名 6 本と内部ネットワーク `192.168.64.0/24` を Cloudflare に公開する（`docs/spec.md` 3.1, 3.4, 8.1）。

前提

- `example.com` の DNS が Cloudflare にある（`docs/verify.md` D-1）
- VM の IP を固定済み（`docs/verify.md` B-2）。未確定なら `.10` / `.11` のまま進め、あとで `config.yml` を直す
- Mac から外向き 7844/TCP（と 443）が出られる（自宅ルーターのポートは開けない。CLAUDE.md 1）
- 作業は Taro が host のターミナルで行う。`tunnel login` はブラウザが要る

参考（公式）

- 作成手順：https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/create-local-tunnel/
- 設定ファイル：https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/configuration-file/
- macOS サービス化：https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/as-a-service/macos/
- コマンド一覧：https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/tunnel-useful-commands/
- 内部ネットワーク：https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/private-net/cloudflared/connect-cidr/

---

## 1. インストール

```bash
brew install cloudflared
cloudflared --version
```

期待：`cloudflared version 2025.x.x` のように出る（2023.9.0 より新しいこと。`warp-routing` の扱いが変わるため）。

## 2. Cloudflare にログイン（`cert.pem` を作る）

```bash
cloudflared tunnel login
```

ブラウザが開くので Cloudflare アカウントでログインし、ゾーン `example.com` を選ぶ。

期待：`~/.cloudflared/cert.pem` ができる。これはトンネルの作成や DNS ルート登録に使う管理用の証明書（秘密情報。コミットしない。他のマシンにコピーしない）。

確認：

```bash
ls -l ~/.cloudflared/cert.pem
```

## 3. トンネルを作る

```bash
cloudflared tunnel create macmini
cloudflared tunnel list
```

期待：UUID と `~/.cloudflared/<TUNNEL_ID>.json` のパスが表示される。`tunnel list` に `macmini` が出る（まだ `CONNECTIONS` は空）。

控えるもの：`<TUNNEL_ID>`（UUID）。この JSON がトンネルの認証情報（秘密情報）。

## 4. DNS ルート 6 本

公開ホスト名ごとに CNAME（`<TUNNEL_ID>.cfargotunnel.com` 宛て）を作る。

```bash
for h in ssh-host vnc-host ssh-vm1 vnc-vm1 ssh-vm2 vnc-vm2; do
  cloudflared tunnel route dns macmini "$h.example.com"
done
```

期待：各行で `Added CNAME ... which will route to this tunnel tunnelID=...` のようなメッセージ。

確認：Cloudflare ダッシュボード › `example.com` › DNS › Records に 6 本の CNAME（Proxied）があること。または

```bash
dig +short ssh-host.example.com
```

で Cloudflare の IP が返る。

## 5. 内部ネットワークのルート（WARP 経由・B の経路）

```bash
cloudflared tunnel route ip add 192.168.64.0/24 macmini
cloudflared tunnel route ip show
```

期待：`route ip show` に `192.168.64.0/24` が `macmini` のトンネルに紐づいて出る（virtual network は `default`）。

ダッシュボードでは Zero Trust › Networking › Routes に同じ行が出る。

※ ルートを登録しただけでは端末からは届かない。WARP 側の Split Tunnel と Gateway のプロキシ設定が必要（`cloudflare/warp/setup.md`）。

## 6. 設定ファイルと認証情報を `/etc/cloudflared/` に置く

LaunchDaemon（root）は `/etc/cloudflared/config.yml` を読むので、ユーザーの `~/.cloudflared/` から移す。

```bash
sudo mkdir -p /etc/cloudflared
sudo cp ~/.cloudflared/<TUNNEL_ID>.json /etc/cloudflared/
sudo cp /path/to/repo/cloudflare/cloudflared/config.yml.example /etc/cloudflared/config.yml
sudo chown -R root:wheel /etc/cloudflared
sudo chmod 755 /etc/cloudflared
sudo chmod 600 /etc/cloudflared/<TUNNEL_ID>.json
sudo chmod 644 /etc/cloudflared/config.yml
```

`config.yml` の `<TUNNEL_ID>` を UUID に、VM の IP を B-2 の結果に合わせて書き換える。

```bash
sudo vi /etc/cloudflared/config.yml
```

ingress の文法確認：

```bash
sudo cloudflared --config /etc/cloudflared/config.yml tunnel ingress validate
sudo cloudflared --config /etc/cloudflared/config.yml tunnel ingress rule https://ssh-vm1.example.com
```

期待：`OK` と、2 行目は `ssh://192.168.64.10:22` のルールにマッチしたと出る。

置き場のまとめ

| ファイル | 置き場 | 権限 | 備考 |
| --- | --- | --- | --- |
| `config.yml` | `/etc/cloudflared/config.yml` | root, 644 | リポジトリの `config.yml.example` から作る |
| `<TUNNEL_ID>.json` | `/etc/cloudflared/<TUNNEL_ID>.json` | root, 600 | 秘密情報。コミットしない。バックアップは Taro のパスワードマネージャーに |
| `cert.pem` | `~/.cloudflared/cert.pem`（Taro のホーム） | 600 | 管理用。常駐には不要。`route dns` などを打つときだけ使う |

`~/.cloudflared/<TUNNEL_ID>.json` は `/etc/cloudflared/` に移したら消してよい（`rm -P`）。

## 7. 手動で一度動かして確認

```bash
sudo cloudflared --config /etc/cloudflared/config.yml tunnel run macmini
```

期待：`Registered tunnel connection` が 4 行（4 本の接続）出る。別ターミナルで

```bash
cloudflared tunnel info macmini
```

に接続（CONNECTOR ID と所在地）が出る。Ctrl-C で止める。

## 8. LaunchDaemon として常駐

方法は 2 つ。**リポジトリの plist（`mac/launchd/`）を使う**のが基本。`cloudflared service install` は plist を自動生成するだけなので、どちらでもよいが両方入れない。

### 8a. リポジトリの plist（推奨）

`mac/launchd/com.cloudflare.cloudflared.plist`（フェーズ2 で作成）を `/Library/LaunchDaemons/` に置く。中身は `ProgramArguments` に `/opt/homebrew/bin/cloudflared tunnel --config /etc/cloudflared/config.yml run`、`KeepAlive: true`、`RunAtLoad: true`、ログは `/Library/Logs/cloudflared/cloudflared.{out,err}.log`（`cloudflared service install` で作った場合は `/Library/Logs/com.cloudflare.cloudflared.{out,err}.log`）。

```bash
sudo cp mac/launchd/com.cloudflare.cloudflared.plist /Library/LaunchDaemons/
sudo chown root:wheel /Library/LaunchDaemons/com.cloudflare.cloudflared.plist
sudo chmod 644 /Library/LaunchDaemons/com.cloudflare.cloudflared.plist
sudo launchctl bootstrap system /Library/LaunchDaemons/com.cloudflare.cloudflared.plist
```

### 8b. `cloudflared service install`

```bash
sudo cloudflared service install
```

`sudo` 付きで実行すると LaunchDaemon（起動時に開始、`/etc/cloudflared` を読む）として入る。`sudo` なしだと LaunchAgent（ログイン後）になるので必ず `sudo` を付ける。ラベルは `com.cloudflare.cloudflared`。plist の置き場は `/Library/LaunchDaemons/com.cloudflare.cloudflared.plist`（要確認：公式ページは plist のパスを明記していない。上記は run-parameters ページの記述）。

### 確認

```bash
sudo launchctl print system/com.cloudflare.cloudflared | head -20
tail -n 20 /Library/Logs/com.cloudflare.cloudflared.err.log
cloudflared tunnel info macmini
```

期待：`state = running`、ログに `Registered tunnel connection`、`tunnel info` に接続が 4 本。

再起動・設定変更後の反映（`docs/spec.md` 3.4）：

```bash
sudo launchctl kickstart -k system/com.cloudflare.cloudflared
```

Mac を再起動して、ログイン画面のまま（自動ログイン前でも）`tunnel info` が接続を示すことも確認する（LaunchDaemon なのでログイン不要）。

## 9. ダッシュボードで確認

Zero Trust › Networking › Tunnels に `macmini` が `HEALTHY` で出る。Routes に `192.168.64.0/24` と公開ホスト名 6 本（ローカル設定なので hostname は `cloudflared` 側で管理と表示される）。

ここまでで公開ホスト名は Cloudflare に届くが、Access アプリがないと誰でも SSH の入口に到達できる状態（sshd の認証はある）。**続けて `cloudflare/access/setup.md` の SSH/VNC アプリを作る**まで、`route dns` の直後に放置しない。

## 10. 困ったとき

| 症状 | 見るところ |
| --- | --- |
| `tunnel info` に接続が出ない | `/Library/Logs/com.cloudflare.cloudflared.err.log`。7844/TCP が外に出られるか（`nc -vz region1.v2.argotunnel.com 7844`） |
| `ssh-vm1` だけ繋がらない | host から `nc -vz 192.168.64.10 22`。VM が起動しているか、IP が B-2 と一致するか |
| 設定を変えたのに反映されない | `/etc/cloudflared/config.yml` を編集したか（`~/.cloudflared/config.yml` ではない）。`kickstart -k` で再起動したか |
| 2 つの cloudflared が動いている | `launchctl print system/com.cloudflare.cloudflared` と `launchctl print gui/$(id -u)/com.cloudflare.cloudflared` の両方を見て、LaunchAgent 側は `cloudflared service uninstall`（sudo なし）で消す |

cloudflared の更新は `brew upgrade cloudflared` → `kickstart -k`。エージェントは cloudflared を触らない（`docs/spec.md` 13章 #2）。
