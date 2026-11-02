# WARP 経由（経路 B）の設定手順

本人が普段使うスマホ・PC に Cloudflare One Client（WARP）を入れ、内部 IP（`192.168.64.x`）に SSH アプリ／VNC アプリで直接つなぐ（`docs/spec.md` 8.2 の B、3.4）。

前提

- Tunnel に `192.168.64.0/24` のルートが登録済み（`cloudflare/cloudflared/setup.md` 5）
- Google の IdP 登録済み（`cloudflare/access/setup.md` 1）
- Gateway SSH CA の公開鍵を 3 台の `/etc/ssh/ca.pub` に登録済み（`cloudflare/access/setup.md` 5）
- VM の IP が固定済み（`docs/verify.md` B-2）、host が `192.168.64.1` で sshd に応答する（B-3）

内部 IP

| マシン | IP | ユーザー名 |
| --- | --- | --- |
| host | `192.168.64.1` | `taro` |
| vm1 | `192.168.64.10`（B-2 の結果） | Hanako、`taro` |
| vm2 | `192.168.64.11`（B-2 の結果） | Jiro、`taro` |

順番：1 端末登録 → 2 Split Tunnels → 3 Gateway プロキシ → 4 Access for Infrastructure → 5 画面共有の許可 → 6 利用者の手順 → 7 切り分け

要確認：Access for Infrastructure（SSH）のプラン条件。公式ページにプラン制限の記載はないが、Free プランで Targets / Infrastructure アプリが作れることを実機で確認する（作れなければ A のブラウザ経路だけで運用し、B は VNC のみ）。

---

## 1. 端末登録（Device enrollment）

公式：https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/warp/deployment/device-enrollment/

Zero Trust › Team & Resources › Devices › Device profiles › **Management**（旧：Settings › WARP Client › Device enrollment permissions）› Device enrollment › **Manage**

- **Policies** タブ › Add a policy
  - Policy name：`members`
  - Action：Allow
  - Include › Selector **Emails** › `taro@example.com`、Hanako のメール、Jiro のメール（閲覧者は入れない。B は接続できる人だけ）
- **Login methods** タブ › Google だけを選ぶ。Instant authentication をオン
- Save

Device client settings（同じ画面の下）：**Allow devices to leave organization** は既定のまま（オンでよい。本人が自分の端末から外せる方が運用上楽）。

期待：Taro のメールで端末登録ができ、一覧外のメールは「You don't have permission」。

## 2. Split Tunnels で `192.168.64.0/24` を通す（`docs/verify.md` D-4）

公式：https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/configure/route-traffic/split-tunnels/
（例：https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/private-net/cloudflared/connect-cidr/ の Split Tunnels の節）

既定は **Exclude** モードで、私設アドレス `10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`、`100.64.0.0/10` などが丸ごと除外されている。`192.168.64.0/24` は `192.168.0.0/16` に含まれているので、このままでは WARP を通らず、B は一切つながらない。

Zero Trust › Team & Resources › Devices › Device profiles › **General profiles**（旧：Settings › WARP Client › Device settings › Profile settings）› Default profile › **Configure** › **Split Tunnels** › **Manage**

手順（Exclude モードのまま）

1. モードが **Exclude IPs and domains** であることを確認（Include に切り替えない。切り替えると一覧が既定に戻る）
2. 一覧から **`192.168.0.0/16`** を削除
3. 代わりに、`192.168.64.0/24` を**除いた**残りの範囲を **Add** で 8 本追加する：

| 追加する CIDR | 含む範囲 |
| --- | --- |
| `192.168.0.0/18` | 192.168.0.0 〜 192.168.63.255（自宅の 192.168.1.0/24 などはここ） |
| `192.168.65.0/24` | 192.168.65.x |
| `192.168.66.0/23` | 192.168.66.x 〜 67.x |
| `192.168.68.0/22` | 192.168.68.x 〜 71.x |
| `192.168.72.0/21` | 192.168.72.x 〜 79.x |
| `192.168.80.0/20` | 192.168.80.x 〜 95.x |
| `192.168.96.0/19` | 192.168.96.x 〜 127.x |
| `192.168.128.0/17` | 192.168.128.x 〜 255.x |

（公式が案内する「Base CIDR / Subtracted CIDRs の計算機」で `192.168.0.0/16` − `192.168.64.0/24` を計算した結果と同じ）

4. Save

期待：一覧に `192.168.0.0/16` がなく、上の 8 本と他の既定（`10.0.0.0/8` など）が残っている。`192.168.64.0/24` だけが除外されない＝WARP を通る。

注意

- 既定の除外を触るとローカル資源（プリンタ、NAS）に届かなくなることがある、と公式が警告している。上の 8 本を入れ直せば `192.168.64.0/24` 以外は従来どおり
- メンバーの自宅 LAN が偶然 `192.168.64.0/24` だと、その人は自宅では B が使えない（ローカルの LAN が優先される）。その場合は A（ブラウザ）か、LAN 側のアドレスを変える
- 元に戻すには **Restore default entries**（要確認：ボタン名。旧 UI にはある）

端末側の確認（登録後）：

```bash
# macOS。Cloudflare One Client を入れた端末で
warp-cli status
warp-cli registration show
netstat -rn | grep 192.168.64
```

期待：`Status update: Connected`、ルーティングテーブルで `192.168.64/24` が WARP のインターフェース（`utun` 系）に向いている。

## 3. Gateway のプロキシ（TCP）を有効にする

公式：https://developers.cloudflare.com/cloudflare-one/traffic-controls/proxy/

Zero Trust › Traffic policies › **Traffic settings**（旧：Settings › Network）› Proxy and inspection settings › **Allow Secure Web Gateway to proxy traffic** をオン

- **TCP**：必須（SSH、VNC）
- **UDP**：不要（内部 DNS を使わない）。オンでも害はない
- **ICMP**：任意。`ping 192.168.64.10` で切り分けしたいならオン

期待：トグルがオン。これは Cloudflare One Client の端末からの通信だけに効く。

## 4. Access for Infrastructure（SSH）

公式：https://developers.cloudflare.com/cloudflare-one/access-controls/applications/non-http/infrastructure-apps/
公式（SSH チュートリアル）：https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/use-cases/ssh/ssh-infrastructure-access/

### 4-1 ターゲット 3 つ

Zero Trust › Access controls › **Targets** › **Add a target**

| Target hostname（ラベル。DNS ではない） | IP addresses（IPv4） | Virtual network |
| --- | --- | --- |
| `host` | `192.168.64.1` | default |
| `vm1` | `192.168.64.10` | default |
| `vm2` | `192.168.64.11` | default |

IP がドロップダウンに出ないときは Networking › Routes に `192.168.64.0/24` があるか確認。

タグ（任意）：`env=host` など。ホスト名はマシン名で固定し、人が替わっても変えない（CLAUDE.md）。

### 4-2 Infrastructure アプリ

Zero Trust › Access controls › Applications › **Create new application** › **Infrastructure**

マシンごとにアプリを分ける（ポリシーの「入れる人」と SSH ユーザー名が違うため）。

| Application name | Target criteria | Protocol / Port | Session duration |
| --- | --- | --- | --- |
| `ssh-infra-host` | Target hostname = `host` | SSH / 22 | 1 hour |
| `ssh-infra-vm1` | Target hostname = `vm1` | SSH / 22 | 1 hour |
| `ssh-infra-vm2` | Target hostname = `vm2` | SSH / 22 | 1 hour |

各アプリのポリシー（`docs/spec.md` 8.3）：

| アプリ | Policy name | Include › Emails | Connection context › **SSH user** | Allow users to log in as their email alias |
| --- | --- | --- | --- | --- |
| `ssh-infra-host` | `host-only` | `taro@example.com` | `taro` | オン |
| `ssh-infra-vm1` | `vm1-users` | Hanako のメール、`taro@example.com` | Hanako のユーザー名、`taro` | オン |
| `ssh-infra-vm2` | `vm2-users` | Jiro のメール、`taro@example.com` | Jiro のユーザー名、`taro` | オン |

- **SSH user** に書いたユーザー名でログインできる。Cloudflare はユーザーを作らないので、ゲスト側に先に作っておく（Taro が vm1 に `taro` で入るなら、vm1 に `taro` ユーザーが要る。Hanako のアカウントで入るならそのユーザー名を書く。どちらにするかは `docs/setup-mac.md` で決める）
- Session duration はアプリ側で 1 hour（接続がこの時間で切れる）。Gateway 経由の接続は最長 10 時間で切れる仕様もある
- ポートフォワード、ProxyJump、agent forwarding、X11 は使えない

**実際に作ったもの（2026-10-31〜11-01）**：アプリは 3 つに分けず、1 つの Infrastructure アプリ `agentstation-ssh`（ターゲット host / vm1 / vm2、SSH 22、Session duration 24h）にポリシー `agentstation ssh users` を 1 本。Include は taro / hanako / jiro のメール、「email alias でログイン可」オン、SSH user に `hanako` と `jiro`（2026-11-01 02:25 に API で追加。それまでは alias のみだったので、Taro は `taro@192.168.64.1` にしか入れなかった）。ポリシーが共通なので、3 人とも `hanako@192.168.64.10` と `jiro@192.168.64.11` に入れる（Hanako が vm2 に、Jiro が vm1 に入れてしまう）。マシンごとに分けたくなったら、上の表のようにアプリを 3 つに分ける。

期待：保存後、Access controls › Applications に 3 つの Infrastructure アプリ。

### 4-3 Gateway の順序ポリシー（推奨）

公式が「Access Infrastructure Target が Present なら Allow」のネットワークポリシーを先頭に置くよう推奨している。Traffic policies › Firewall policies › Network › Add a policy：

| Policy name | Selector | Operator | Value | Action |
| --- | --- | --- | --- | --- |
| `allow-infra-targets` | Access Infrastructure Target | Present | — | Allow |

これは経路の許可だけで、Access のポリシーは別途評価される。

## 5. 画面共有用の Gateway ネットワークポリシー（5900/TCP）

公式：https://developers.cloudflare.com/cloudflare-one/policies/gateway/network-policies/

VNC は Access for Infrastructure の対象外（SSH のみ）なので、Gateway のネットワークポリシーで「誰が 5900 に届けるか」を決める。既定で Gateway は Allow（ブロックポリシーがなければ通る）なので、**ブロックを先に、許可を後に**作る。

Zero Trust › Traffic policies › **Firewall policies** › **Network** › Add a policy（旧：Gateway › Firewall policies › Network）

ポリシー 1（許可。順序を上に）

| Policy name | Traffic | Identity | Action |
| --- | --- | --- | --- |
| `vnc-allow-members` | Destination IP `in` `192.168.64.0/24` **And** Destination Port `is` `5900` | User Email `in` `taro@example.com`, Hanako のメール, Jiro のメール | **Allow** |

ポリシー 2（その他は遮断。順序を下に）

| Policy name | Traffic | Action |
| --- | --- | --- |
| `vnc-block-others` | Destination IP `in` `192.168.64.0/24` And Destination Port `is` `5900` | **Block** |

式で書くと：

```
# vnc-allow-members
any(net.dst.ip[*] in {192.168.64.0/24}) and net.dst.port == 5900 and identity.email in {"taro@example.com" "..." "..."}
# vnc-block-others
any(net.dst.ip[*] in {192.168.64.0/24}) and net.dst.port == 5900
```

- マシンごとに「vm1 の 5900 は Hanako と Taro だけ」と分けたいなら、Destination IP を `192.168.64.10` にした Allow を 3 本作る（spec 8.3 と同じ粒度）。まずは一括で始め、必要なら分ける
- VNC のパスワードは別途 macOS 側（`cloudflare/access/setup.md` 4 章）。Gateway は「届けるか」だけ
- 端末登録していない人は WARP を通れないので、そもそも 192.168.64.x に届かない

期待：Hanako の端末から `nc -vz 192.168.64.10 5900` が通り、閲覧者（登録不可）は届かない。Gateway の Logs › Network に Allow の行。

## 6. 利用者側の手順

公式（手動導入）：https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/deployment/manual-deployment/

### 6-1 Cloudflare One Client を入れてチームにログイン

- macOS：Cloudflare One Client（旧 Cloudflare WARP）をダウンロード → メニューバーのアイコン › 歯車 › Preferences › Account › **Login with Cloudflare Zero Trust** › チーム名 `<team>` を入力 → Google でログイン → 「Open Cloudflare WARP.app」
- iPhone / iPad：App Store の **Cloudflare One Agent** → Next → プライバシーポリシーに Accept → チーム名を入力 → Google でログイン → **Install VPN Profile** → OK → **Connected** をオン
- Windows / Android も同じ流れ

チーム名の打ち間違いを防ぐため、Taro がログイン URL を配る：`cf1app://oneapp.cloudflare.com/team?name=<team>`（QR コードにしてもよい）。すでに別チームにログイン済みの端末は Settings › Account でログアウトしてから。

期待：クライアントが **Connected**。`https://help.teams.cloudflare.com/` を開くと「Your network is fully protected」、Team name が `<team>`、WARP と Gateway Proxy が有効。

### 6-2 SSH

Mac / PC（ターミナル）。WARP がつながっていれば鍵も設定も不要：

```bash
ssh taro@192.168.64.1          # host
ssh <hanako>@192.168.64.10    # vm1
ssh <jiro>@192.168.64.11       # vm2
warp-cli target list           # 自分が入れるターゲットとユーザー名の一覧
```

期待：パスワードも鍵も聞かれずにシェルに入る（短期証明書）。`target list` に出るのに入れないときは「SSH user」にそのユーザー名がない。

iPhone の SSH アプリ：ホストに `192.168.64.10`、ポート 22、ユーザー名、認証は空のまま接続する。**確認済み（2026-11-01）**：WebSSH は WARP 経由・短期証明書でつながる。Termius は Cloudflare の SSH プロキシとのハンドシェイクで切られて使えない（`end of file` / `connection reset by peer`。Access の認証ログにも残らない）。Wi‑Fi 上では iOS の「ローカルネットワーク」許可が要る（無いと無言でタイムアウト。モバイル回線では不要）。詳細は `docs/verify.md` 2026-11-01

### 6-3 画面共有（VNC）

- Mac：Finder › 移動 › サーバへ接続 › `vnc://192.168.64.10` → VNC パスワード。または画面共有.app
- iPhone / iPad：VNC アプリ（RealVNC Viewer など。**要確認**：どのアプリが macOS の画面共有と WARP 経由で動くか）に `192.168.64.10:5900` → VNC パスワード
- Windows：RealVNC Viewer / TigerVNC

期待：各環境のデスクトップが見える。ダッシュボードの「接続」の B 側は、この IP とポートを表示するだけ（パスワードは出さない）。

### 6-4 ダッシュボードの「接続」セクションに出す情報

| 環境 | SSH（B） | VNC（B） | ファイルアプリ（B。6-5） |
| --- | --- | --- | --- |
| Taro | `ssh taro@192.168.64.1` | `vnc://192.168.64.1` | `smb://192.168.64.1/workspace` |
| Hanako | `ssh <hanako>@192.168.64.10` | `vnc://192.168.64.10` | `smb://192.168.64.10/workspace` |
| Jiro | `ssh <jiro>@192.168.64.11` | `vnc://192.168.64.11` | `smb://192.168.64.11/workspace` |

### 6-5 iPhone の「ファイル」アプリで各自の `workspace` を開く（SMB）

各マシンの利用者の `~/workspace` を SMB で共有し、WARP 経由で iPhone / iPad の「ファイル」アプリから開く。アプリの追加は不要。

| マシン | 共有 | 登録ユーザ | 入れる人（Gateway） |
| --- | --- | --- | --- |
| host | `smb://192.168.64.1/workspace` | `taro` | taro |
| vm1 | `smb://192.168.64.10/workspace` | `hanako` | hanako、taro |
| vm2 | `smb://192.168.64.11/workspace` | `jiro` | jiro、taro |

Cloudflare 側（2026-11-01 に API で確認・設定済み）：

- 通すための設定は既存のもので足りる：Tunnel のルート `192.168.64.0/24`、Split Tunnels（2 章）、Gateway プロキシ TCP（3 章。`devices/settings` の `gateway_proxy_enabled: true`）
- 絞るために Traffic policies › Firewall policies › Network に Block を 3 本追加した（マシンごとに 445 番を「その利用者と taro 以外」から遮断。SSH・VNC には影響しない）：

| Policy name | Traffic | Identity | ID |
| --- | --- | --- | --- |
| `smb-host-taro-only` | `net.dst.ip == 192.168.64.1 and net.dst.port == 445` | `not(identity.email == "taro@example.com")` | `f7d7e787-dff3-4607-8d1b-8ee9323ee67c` |
| `smb-vm1-hanako-only` | `net.dst.ip == 192.168.64.10 and net.dst.port == 445` | `not(identity.email in {"hanako@example.com" "taro@example.com"})` | `0ceb1b94-b618-45df-85ed-0f0d64b23dc2` |
| `smb-vm2-jiro-only` | `net.dst.ip == 192.168.64.11 and net.dst.port == 445` | `not(identity.email in {"jiro@example.com" "taro@example.com"})` | `71ece96e-2ccd-4d26-ba4f-24405efeb0bd` |

Mac 側（各マシンで 1 回。`mac/scripts/smb-workspace.sh`）。やること：(1) 利用者の SMB-NT ハッシュを有効化（既定では無く、SMB ログインが通らない。現在のパスワードを受け取り、同じパスワードで設定し直してハッシュを作る。GUI の「ファイル共有 › オプション › ユーザーをオン」でパスワードを聞かれるのと同じ。パスワードは変わらない）、(2) ファイル共有（smbd）を有効化、(3) 共有ポイント `workspace` を追加（ゲスト不可）。

```bash
cd ~/workspace/agentstation
# host（Taro 本人。パスワードを聞かれる）
sudo bash mac/scripts/smb-workspace.sh
# vm1 / vm2（host から。パスワードは ~/.config/agentstation/<env>-secrets の USER_PW を標準入力で渡す。2026-11-01 実施済み）
scp mac/scripts/smb-workspace.sh admin@192.168.64.10:/tmp/
sed -n 's/^USER_PW=//p' ~/.config/agentstation/vm1-secrets | ssh admin@192.168.64.10 'sudo bash /tmp/smb-workspace.sh hanako; rm /tmp/smb-workspace.sh'
scp mac/scripts/smb-workspace.sh admin@192.168.64.11:/tmp/
sed -n 's/^USER_PW=//p' ~/.config/agentstation/vm2-secrets | ssh admin@192.168.64.11 'sudo bash /tmp/smb-workspace.sh jiro; rm /tmp/smb-workspace.sh'
```

期待：`smbd が 445 で待受中` と `workspace` の共有。host から `smbutil view //hanako@192.168.64.10`（パスワードは USER_PW）で `workspace` が一覧に出る。

iPhone 側（ガイド「入り方」の「スマホの『ファイル』アプリ」と同じ）：

1. Cloudflare One Agent が **Connected**
2. ファイル › 右上の「…」› **サーバへ接続** › 上の表のアドレス
3. **登録ユーザ** › 名前はそのマシンのユーザー名、パスワードは Mac のログインパスワード › 次へ
4. `workspace` を選ぶ。サイドバーの「共有」に残るので次回からはタップするだけ

注意

- Wi‑Fi 上では「設定 › アプリ › ファイル › ローカルネットワーク」の許可が要ることがある（6-2 の SSH アプリと同じ。無いと無言でタイムアウト）
- `192.168.64.1` は Tart の NAT ブリッジ（`bridge100`）のアドレスで、VM が 1 台も動いていないと消える。vm1/vm2 は常駐なので通常は問題ない
- 利用者は管理者ユーザーなので、`workspace` のほかにホーム全体と `Macintosh HD` も共有一覧に出る（macOS の既定）
- 利用者がログインパスワードを変えたら SMB-NT ハッシュは新しいパスワードで作り直される（`-sethashtypes` は残る）。自動ログイン（kcpassword）だけ直せばよい
- VM を作り直したときは stage3 のあとに上のコマンドをもう一度（`docs/initial-setup.md` 5.9）
- 戻すとき：各マシンで `sudo sharing -r workspace` と `sudo launchctl unload -w /System/Library/LaunchDaemons/com.apple.smbd.plist`。Gateway のポリシー 3 本は削除

## 7. つながらないときの切り分け

公式：https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/troubleshoot-tunnels/private-networks/

上から順に。

| # | 確認 | コマンド／場所 | 直すところ |
| --- | --- | --- | --- |
| 1 | クライアントが Connected か | `warp-cli status`、メニューバーの表示 | 再ログイン。端末登録ポリシーのメール |
| 2 | `192.168.64.0/24` が WARP に向いているか | `netstat -rn \| grep 192.168.64`（utun に向くか） | 2 章の Split Tunnels。自宅 LAN が `192.168.64.x` と衝突していないか |
| 3 | Gateway が通しているか | Zero Trust › Insights › Logs › Network で宛先 IP を検索。Blocked なら Policy name を見る | 5 章の Allow の順序。3 章のプロキシ TCP |
| 4 | ルートが Tunnel に届いているか | Networking › Routes に `192.168.64.0/24`。`cloudflared tunnel route ip show` | `cloudflare/cloudflared/setup.md` 5 |
| 5 | Tunnel が生きているか | `cloudflared tunnel info agentstation`、Networking › Tunnels が HEALTHY | host の cloudflared を `kickstart -k` |
| 6 | host から宛先に届くか | host で `nc -vz 192.168.64.10 22`、`nc -vz 192.168.64.1 22` | VM の起動・IP（B-2）。host の `192.168.64.1`（B-3）。macOS のファイアウォールでリモートログイン／画面共有が許可されているか |
| 7 | SSH が証明書で拒否されるか | `ssh -v user@192.168.64.10` の `Authentications that can continue` | `/etc/ssh/ca.pub` に Gateway SSH CA が入っているか、`sshd -T \| grep trusteduserca`、ユーザーがマシンに存在するか、Infrastructure ポリシーの SSH user |
| 8 | Access のポリシーで拒否されているか | `warp-cli target list` に出るか。Insights › Logs › Access authentication logs | 4-2 のポリシー（メール、SSH user） |
| 9 | VNC だけだめ | `nc -vz 192.168.64.10 5900`。macOS 側で画面共有オン、VNC パスワード設定済みか | `cloudflare/access/setup.md` 4 章の VNC 設定。5 章の Gateway ポリシー |

A（ブラウザ）が通って B だけだめなら 1〜5、両方だめなら 5〜9 から見る。
