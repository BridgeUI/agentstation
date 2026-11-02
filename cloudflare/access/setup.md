# Cloudflare Access（Zero Trust）の設定手順

> **`kit/cloudflare-setup.mjs` で作る場合はこの手順は要らない**（`kit/START.md` 3 章）。この文書は Access を手で作る・直すときの参照。

ダッシュボード・エージェント API・SSH×3・VNC×3 を Access で守る（`docs/spec.md` 4.1, 8, 9）。

前提

- Worker が `workstation.example.com` にデプロイ済み（`cloudflare/worker/setup.md`）
- Tunnel と公開ホスト名 6 本が動いている（`cloudflare/cloudflared/setup.md`）
- Zero Trust の組織（チーム名）がある。なければ Cloudflare ダッシュボード › Zero Trust で作る（Free プランで可）

UI の名称は 2026 年時点の Cloudflare ダッシュボード（Zero Trust › Access controls / Integrations / Team & Resources ...）に合わせている。旧表記（Access › Applications、Settings › Authentication）は括弧で添える。違っていたら公式ページの URL を見る。

順番：1 IdP → 2 ダッシュボード → 3 エージェント API → 4 SSH/VNC → 5 SSH CA → 6 ログで検証

---

## 1. チーム名の確認と Google の IdP 登録

### 1-1 チーム名

Zero Trust › Settings › Custom Pages（または Settings の先頭）に **Team name and domain** がある。`<team>.cloudflareaccess.com` の `<team>` を控える。

これが `worker/wrangler.toml` の `ACCESS_TEAM_DOMAIN`（`<team>.cloudflareaccess.com`）になり、JWT の `iss`（`https://<team>.cloudflareaccess.com`）の検証にも使う（`worker/src/auth.ts`）。

### 1-2 Google Cloud で OAuth クライアントを作る（`docs/verify.md` D-2）

公式：https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/

1. Google Cloud Console でプロジェクトを作る（例：`agentstation-access`）
2. APIs & Services › Credentials › Configure Consent Screen
   - App name、User support email を入れる
   - Audience は **External**（Hanako・Jiro が example.com 以外の Google アカウントの可能性があるため。全員が Google Workspace の同一ドメインなら Internal でもよい）
3. Create OAuth client › Application type **Web application**
   - Authorized JavaScript origins：`https://<team>.cloudflareaccess.com`
   - Authorized redirect URIs：`https://<team>.cloudflareaccess.com/cdn-cgi/access/callback`
4. 表示される **Client ID** と **Client secret** を控える（秘密情報。Taro のパスワードマネージャーへ）

### 1-3 Zero Trust に登録

Zero Trust › Integrations › Identity providers（旧：Settings › Authentication › Login methods）› **Add new identity provider** › **Google**

- Name：`Google`
- App ID：Google の Client ID
- Client secret：Google の Client secret
- PKCE：任意（有効でよい）
- Save → 一覧の Google の **Test** を押す

期待：Google のログイン画面 → 「Your connection works!」の画面。

### 1-4 ワンタイム PIN を使わない

- 既存組織には One-time PIN が最初から入っていることが多い。Identity providers の一覧で **One-time PIN** を削除する（要確認：削除ボタンの名称。公式ページには無効化手順の記載なし：https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/ ）
- 削除できない／残したい場合は、各 Access アプリの **Identity providers** で Google だけを選ぶ（「Accept all available identity providers」を外す）。本書のアプリ作成手順はすべてこれを前提にする
- 2026 年以降に作った組織では既定が「Cloudflare を IdP」になっている（Changelog 2026-06-18）。これも各アプリで外す

---

## 2. Access アプリ「ダッシュボード」（`workstation.example.com`）

公式（self-hosted アプリ）：https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/

Zero Trust › Access controls › Applications › **Create new application** › **Self-hosted and private**（旧：Add an application › Self-hosted）

| 項目                         | 値                                                                  |
| ---------------------------- | ------------------------------------------------------------------- |
| Application name             | `agentstation`                                                      |
| Session Duration             | **24 hours**                                                        |
| Public hostname              | Domain `example.com`、Subdomain `mac`、Path は空                    |
| Identity providers           | **Google** のみ（Accept all を外す。One-time PIN を入れない）       |
| Apply instant authentication | オン（IdP が 1 つなので Access のログイン画面を飛ばして Google へ） |

ポリシー（**Add a policy**、Action **Allow**）

| Policy name | Action | Rule    | Selector | Value                                                              |
| ----------- | ------ | ------- | -------- | ------------------------------------------------------------------ |
| `members`   | Allow  | Include | Emails   | `taro@example.com`、Hanako のメール、Jiro のメール、閲覧者のメール |

- ロールの判定は Worker 側（`MEMBERS_JSON`）で行う。Access はメール一覧で「入れる人」を絞るだけ。閲覧者もここに入れる
- Session duration はポリシー側にも項目があるが、アプリ側と同じ 24 hours にする（ポリシー側が「Same as application session timeout」ならそのまま）
- Additional settings：**Enable automatic cloudflared authentication** はオフ。**Cookie settings** の HttpOnly はオン、SameSite は Lax（既定）

保存後、アプリの **Configure** › **Additional settings**（旧：Overview）に **Application Audience (AUD) Tag** がある。これを `worker/wrangler.toml` の `ACCESS_AUD_DASHBOARD` に入れる（`wrangler deploy` し直す）。AUD はアプリを消して作り直さない限り変わらない。

公式（AUD の場所）：https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/

確認

- シークレットウィンドウで `https://workstation.example.com/` を開く → Google のログイン → 画面が出る
- 一覧にないメールで入る → Access の「You don't have permission」画面
- `curl -sI https://workstation.example.com/api/health` → `302` で `<team>.cloudflareaccess.com` へ（未ログインは Worker に届かない）
- ログイン後、ブラウザの開発者ツールで `/api/me` の応答に自分のメールとロールが出る

---

## 3. Access アプリ「エージェント API」（`workstation.example.com/api/agent`）

エージェントは人ではないので、**Service Auth** だけのアプリを `/api/agent` のパスに作る。ダッシュボードのアプリ（`workstation.example.com` 全体）より具体的なパスなので、`/api/agent/*` にはこちらが適用される（要確認：Access はパスの長いアプリを優先するはず。公式ページに優先順位の明記がないので、3-4 の確認で実際に Service Auth が効くことを見る）。

### 3-1 サービストークン 3 本

公式：https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/

Zero Trust › Access controls › Service credentials › Service Tokens（旧：Access › Service Auth › Service Tokens）› **Create Service Token**

| Service token name  | Service Token Duration | 渡す先                                      |
| ------------------- | ---------------------- | ------------------------------------------- |
| `agentstation-host` | 1 year                 | host の `~/.config/agentstation/token.json` |
| `agentstation-vm1`  | 1 year                 | vm1 の同じパス                              |
| `agentstation-vm2`  | 1 year                 | vm2 の同じパス                              |

**Generate token** を押すと **Client ID** と **Client Secret** が出る。**Client Secret はこの一度しか表示されない**。失くしたら Rotate secret で作り直す。

名前は `worker/wrangler.toml` の `AGENT_TOKEN_NAMES` の値と同じにする（ログで見分けるため）。

> **重要（`worker/src/auth.ts` に影響）**：Access の JWT で `common_name` に入るのは**サービストークンの Client ID**（`CF-Access-Client-Id` の値）であって、トークンの名前ではない。
> 公式：https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/ （Service token authentication の表：`common_name` = "The Client ID of the service token"）
> したがって `AGENT_TOKEN_NAMES` には **各トークンの Client ID**（`xxxxxxxx....access` の形）を入れる必要がある。`cloudflare/worker/setup.md` 5 章と、この文書末尾の「他の担当への申し送り」を参照。

### 3-2 トークンをエージェントに渡す

各環境で（host は Taro、vm1/vm2 は SSH か画面共有で入って）：

```bash
mkdir -p ~/.config/agentstation
chmod 700 ~/.config/agentstation
umask 077
cat > ~/.config/agentstation/token.json <<'EOF'
{"client_id":"<CLIENT_ID>","client_secret":"<CLIENT_SECRET>"}
EOF
chmod 600 ~/.config/agentstation/token.json
ls -l ~/.config/agentstation/token.json
```

期待：`-rw-------`。`client_id` / `client_secret` のキー名は `agent/src/config.ts` に合わせる。`config.json`（`base_url`）は `docs/setup-mac.md` の手順で作る。

- トークンは**環境ごとに別**。vm1 のトークンを host に置かない（`docs/spec.md` 3.6 (6)）
- シェル履歴に Secret を残さないため、heredoc ではなくエディタで作ってもよい。`history -c` も可
- Secret をダッシュボード・D1・ログ・Slack に出さない（CLAUDE.md 3）

### 3-3 Access アプリ

Zero Trust › Access controls › Applications › **Create new application** › **Self-hosted and private**

| 項目                                                             | 値                                                                                                                             |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Application name                                                 | `agentstation-api`                                                                                                             |
| Session Duration                                                 | 既定のままでよい（Service Auth ではリクエストごとに検証される）                                                                |
| Public hostname                                                  | Domain `example.com`、Subdomain `mac`、**Path `api/agent`**（要確認：Path 欄が UI にあること。公式ページの記述は Domain のみ） |
| Identity providers                                               | 何も選ばない（人は入れない）                                                                                                   |
| Additional settings › **401 Response for Service Auth policies** | **オン**（トークンなしのリクエストにログイン画面へのリダイレクトではなく 401 を返す）                                          |

ポリシー（Action **Service Auth**。Allow を作らない）

| Policy name | Action       | Rule    | Selector      | Value                                                       |
| ----------- | ------------ | ------- | ------------- | ----------------------------------------------------------- |
| `agents`    | Service Auth | Include | Service Token | `agentstation-host`、`agentstation-vm1`、`agentstation-vm2` |

公式（Service Auth と Service Token セレクタ）：https://developers.cloudflare.com/cloudflare-one/access-controls/policies/

保存後、**Application Audience (AUD) Tag** を `worker/wrangler.toml` の `ACCESS_AUD_AGENT` に入れる。

### 3-4 確認

```bash
# トークンなし → 401（401 Response をオンにした場合）または Access のブロック画面（オフなら 302）
curl -si -X POST https://workstation.example.com/api/agent/heartbeat -H 'Content-Type: application/json' -d '{}' | head -1

# host のトークンで → Worker に届く（ペイロードが空なので Worker の 400 が返るのが正常。Access は通過）
curl -si -X POST https://workstation.example.com/api/agent/heartbeat \
  -H "CF-Access-Client-Id: $(jq -r .client_id ~/.config/agentstation/token.json)" \
  -H "CF-Access-Client-Secret: $(jq -r .client_secret ~/.config/agentstation/token.json)" \
  -H 'Content-Type: application/json' -d '{}' | head -1
```

期待：1 つ目は `HTTP/2 401`（または 302/403 で Access のページ）。2 つ目は Worker の応答（`400`）。`401 JWT の aud が違う` が出たら `ACCESS_AUD_AGENT` が別アプリの AUD。`403 このサービストークンはどの環境にも対応していない` が出たら `AGENT_TOKEN_NAMES` が Client ID でなく名前になっている（3-1 の注意）。

また、ブラウザでログインした人が `https://workstation.example.com/api/agent/heartbeat` を開いても Worker に届かないこと（Service Auth のみなので Access が止める）。

### 3-5 有効期限とローテーション

- 期限は作成時の Duration（1 year）。期限切れ前に Zero Trust › Access controls › Service credentials › Service Tokens で **Refresh**（1 年延長）か **Edit** で Duration を変える
- Secret の漏えいが疑われるときは三点メニュー › **Rotate secret**。Client ID は変わらず、旧 Secret を 1 時間〜30 日の猶予で残せる（即時失効も可）。新 Secret を該当環境の `token.json` に入れて `launchctl kickstart -k gui/<uid>/<agent の label>`
- VM が乗っ取られたらその VM のトークンを **Delete**（アプリの Revoke existing tokens はセッションを切るだけで、Client ID/Secret は生きている）
- 期限切れの 1 か月前に気づけるよう、Taro のカレンダーに入れる（Cloudflare からの通知は要確認）

---

## 4. SSH × 3、VNC × 3（ブラウザ表示＝経路 A）

公式（ブラウザ表示）：https://developers.cloudflare.com/cloudflare-one/access-controls/applications/non-http/browser-rendering/
公式（VNC の例）：https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/use-cases/vnc-browser-rendering/

6 つの Self-hosted アプリを作る。共通設定：

| 項目                                                                                   | 値                                                          |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Session Duration                                                                       | **1 hour**                                                  |
| Identity providers                                                                     | Google のみ                                                 |
| Additional settings › **Allow access through browser-based RDP, SSH, or VNC sessions** | オン → SSH アプリは **SSH**、VNC アプリは **VNC**           |
| ポリシー                                                                               | **Allow / Block のみ**（Bypass と Service Auth は使えない） |

| Application name | Public hostname        | Browser rendering | Allow ポリシー（Emails）   |
| ---------------- | ---------------------- | ----------------- | -------------------------- |
| `ssh-host`       | `ssh-host.example.com` | SSH               | `taro@example.com`         |
| `vnc-host`       | `vnc-host.example.com` | VNC               | `taro@example.com`         |
| `ssh-vm1`        | `ssh-vm1.example.com`  | SSH               | Hanako、`taro@example.com` |
| `vnc-vm1`        | `vnc-vm1.example.com`  | VNC               | Hanako、`taro@example.com` |
| `ssh-vm2`        | `ssh-vm2.example.com`  | SSH               | Jiro、`taro@example.com`   |
| `vnc-vm2`        | `vnc-vm2.example.com`  | VNC               | Jiro、`taro@example.com`   |

（`docs/spec.md` 8.3 の表。閲覧者は入れない）

ポリシーは再利用できる（Access controls › Policies で `host-only` / `vm1-users` / `vm2-users` の 3 つを作って各アプリに付けると管理が楽）。

ブラウザ表示の制約

- 公開ホスト名（ドメイン／サブドメイン）だけ。パスやプライベート IP には使えない
- **SSH と VNC ともに、Access のメールの `@` より前がマシン側のユーザー名**。`taro@example.com` → `taro`。Hanako・Jiro のメールの `@` 前がゲストのユーザー名と一致するようにアカウントを作る（`docs/setup-mac.md`）。一致しないメール（例：`hanako.xxx@gmail.com` → `hanako.xxx`）なら、ゲストのユーザー名をそれに合わせるか、別名の Google アカウントを使う。要検討
- SSH：短期証明書で入るには 5 章の CA 登録が要る。登録前はユーザー名とパスワードを聞かれる
- SSH の鍵交換：ブラウザ版が使うのは `curve25519-sha256@libssh.org`、`curve25519-sha256`、`ecdh-sha2-nistp256/384/521`。macOS の sshd の既定に含まれるので通常は変更不要。通らなければ `mac/sshd` の断片に `KexAlgorithms` を足す
- VNC：Access を通ったあと、ブラウザの中で VNC パスワードを聞かれる。macOS 側で システム設定 › 一般 › 共有 › 画面共有 › (i) › **VNC 表示プログラムがパスワードで画面を操作することを許可**（英語：VNC viewers may control screen with password）をオンにしてパスワードを設定する（Apple：https://support.apple.com/guide/mac-help/mh11848/mac ）。パスワードは 8 文字まで。各環境の本人（とオーナー）がパスワードマネージャーで持ち、ダッシュボードに出さない（`docs/spec.md` 8.2）。`docs/verify.md` D-5

確認

- `https://ssh-host.example.com/` を Taro で開く → ブラウザにターミナル → `taro` としてログイン済みのプロンプト（5 章完了後）
- 同じ URL を Hanako で開く → Access の拒否画面
- `https://vnc-vm1.example.com/` を Hanako で開く → VNC パスワード → vm1 の画面
- 1 時間後に再接続すると Google のログインを求められる

---

## 5. SSH の短期証明書（SSH CA）

経路 A（ブラウザ）と経路 B（WARP）で使う CA が別物なので、両方の公開鍵を各マシンの `/etc/ssh/ca.pub` に入れる（1 行 1 鍵で複数可）。

| 経路           | CA の種類                                   | 作り方                                                                                                                          | 本数                              |
| -------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| A ブラウザ表示 | アプリごとの短期証明書 CA（legacy）         | Service credentials › SSH › Add a certificate › Application を選ぶ › Generate certificate                                       | 3（ssh-host / ssh-vm1 / ssh-vm2） |
| B WARP         | Gateway SSH CA（Access for Infrastructure） | Service credentials › SSH › Add a certificate › **Generate SSH CA**、または API `POST /accounts/{account_id}/access/gateway_ca` | 1（アカウントで共通）             |

公式（A）：https://developers.cloudflare.com/cloudflare-one/access-controls/applications/non-http/short-lived-certificates-legacy/
公式（B）：https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/use-cases/ssh/ssh-infrastructure-access/
API（B）：https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/gateway_ca/methods/create/

### 5-1 公開鍵を取る

A：Zero Trust › Access controls › Service credentials › **SSH** › **Add a certificate** › Application に `ssh-host` を選ぶ › **Generate certificate**。一覧の行を開いて **Public key** をコピー。`ssh-vm1`、`ssh-vm2` も同様。

B：同じ画面の **Generate SSH CA**（SSH with Access for Infrastructure の欄）。公開鍵をコピー。API なら：

```bash
# API トークンの権限：Access: SSH Auditing Edit
curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/access/gateway_ca" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq -r '.result.public_key'
# すでにある場合は GET で取る
curl -s "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/access/gateway_ca" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq -r '.result[].public_key'
```

公開鍵は秘密ではない（`ecdsa-sha2-nistp256 AAAA...` の 1 行）。リポジトリの `mac/sshd/` に `ca.pub` として置いてもよい。

### 5-2 各マシンの sshd に登録

host・vm1・vm2 のそれぞれで（vm には host から `ssh hanako@192.168.64.10` などで入る）：

```bash
sudo tee /etc/ssh/ca.pub >/dev/null <<'EOF'
# Access browser-rendered SSH (ssh-host / ssh-vm1 / ssh-vm2 のうち、このマシン用の 1 本)
ecdsa-sha2-nistp256 AAAA...
# Access for Infrastructure (Gateway SSH CA)
ecdsa-sha2-nistp256 AAAA...
EOF
sudo chmod 644 /etc/ssh/ca.pub
sudo cp mac/sshd/50-cloudflare-access.conf /etc/ssh/sshd_config.d/
```

`mac/sshd/50-cloudflare-access.conf`（フェーズ2 で作る断片）の中身：

```
PubkeyAuthentication yes
TrustedUserCAKeys /etc/ssh/ca.pub
```

macOS 13 以降の `/etc/ssh/sshd_config` は先頭で `Include /etc/ssh/sshd_config.d/*` しているので、断片は本体より先に読まれ、優先される。公式は「`sshd_config` の先頭に書く」としているが、Include が先頭なら同じ。

- 各マシンに入れる A 用の鍵は**そのマシンのアプリの 1 本だけ**（host には `ssh-host` の鍵、vm1 には `ssh-vm1` の鍵）。B 用の Gateway CA は 3 台とも同じ 1 本
- `AuthenticationMethods publickey,keyboard-interactive` のような多要素は使えない
- macOS の「リモートログイン」はオンにしておく（システム設定 › 一般 › 共有）

sshd の再読み込み（macOS）：

```bash
sudo launchctl kickstart -k system/com.openssh.sshd
sudo sshd -T | grep -i -E 'trusteduserca|pubkeyauth'
```

期待：`trustedusercakeys /etc/ssh/ca.pub`、`pubkeyauthentication yes`。SSH で入っている最中に実行すると接続が切れる（画面共有かローカルで）。

要確認：macOS の sshd が `launchctl kickstart` で設定を読み直すこと。読み直さなければ `sudo launchctl unload /System/Library/LaunchDaemons/ssh.plist` → `load`、またはリモートログインをオフ→オン。

### 5-3 ユーザー名の対応

| マシン | ユーザー                                                        | メール（@ 前がユーザー名） |
| ------ | --------------------------------------------------------------- | -------------------------- |
| host   | `taro`                                                          | `taro@example.com`         |
| vm1    | Hanako のユーザー名、`taro`（オーナー用の管理アカウント。任意） | Hanako のメール            |
| vm2    | Jiro のユーザー名、`taro`（同上）                               | Jiro のメール              |

A（ブラウザ）は常にメールの `@` 前で入る。Taro が vm1 にブラウザから入るには vm1 に `taro` ユーザーが要る（または B の Infrastructure ポリシーの「SSH user」で別名を許可する。`cloudflare/warp/setup.md` 4 章）。

### 5-4 確認

```bash
# 端末側（Taro の Mac）。cloudflared を入れておく
cloudflared access ssh-config --hostname ssh-host.example.com --short-lived-cert
```

出力を `~/.ssh/config` に足し、`ssh ssh-host.example.com`。ブラウザで Access のログインが開き、ログイン後にパスワードなしで `taro` のシェルに入れる。ブラウザ版（`https://ssh-host.example.com/`）でもパスワードを聞かれずに入れる。

`Origin auth failed` が出たら、`sshd -T` の `trustedusercakeys` と `ca.pub` の鍵が正しいアプリのものかを見る。

---

## 6. Access のログで検証する

公式：https://developers.cloudflare.com/cloudflare-one/insights/logs/dashboard-logs/access-authentication-logs/

Zero Trust › Insights › Logs › **Access authentication logs**（旧：Logs › Access）

| 見たいこと                                 | フィルタ                                 | 期待                                                                 |
| ------------------------------------------ | ---------------------------------------- | -------------------------------------------------------------------- |
| ダッシュボードに誰が入ったか               | Application = `agentstation`             | メール、Allowed、Login method = Google                               |
| 一覧外のメールが拒否されたか               | Action = Blocked / Failed                | 該当メールの行                                                       |
| エージェントが Service Auth で通っているか | Application = `agentstation-api`         | 1 分ごとに 3 本のトークン名（`agentstation-host` など）で Allowed    |
| 失効したトークンが拒否されているか         | Application = `agentstation-api`、Failed | トークン名で Failed（不正な Client ID や壊れたヘッダは記録されない） |
| SSH/VNC に誰が入ったか                     | Application = `ssh-vm1` など             | Allow ポリシーの人だけ                                               |

- ログは認証イベントだけ。SSH のコマンド内容は（Gateway の SSH コマンドログを有効にしない限り）残らない。本プロジェクトではコマンドログを**使わない**（会話内容・ファイル名を Cloudflare に送らないため。CLAUDE.md 3）
- トークンの作成・削除や Access アプリの変更は Cloudflare アカウントの Manage Account › Audit Logs に残る
- API で取るなら `GET /accounts/{account_id}/access/logs/access_requests`（権限 Access: Audit Logs Read）

---

## 他の担当への申し送り（このファイルから反映すべき点）

1. **`worker/wrangler.toml` の `AGENT_TOKEN_NAMES`**：値はトークン名ではなく **Client ID**。コメントを直し、Client ID は（Secret ではないが）リポジトリにコミットしたくないので `[vars]` から外して `wrangler secret put AGENT_TOKEN_NAMES` で入れるのが安全。`worker/src/auth.ts` のロジック自体（`common_name` と一致する環境を引く）は変更不要
2. **`docs/spec.md` 3.6 (6) と 4.1**：「トークンの `common_name`」＝ Client ID である旨を追記
3. **`docs/spec.md` 8.2**：ブラウザ表示の SSH 用 CA はアプリごと（3 本）、WARP 用は Gateway SSH CA（1 本）。`ca.pub` に両方入れる
4. **`mac/sshd/`**：`50-cloudflare-access.conf`（`PubkeyAuthentication yes` / `TrustedUserCAKeys /etc/ssh/ca.pub`）と、`ca.pub` の雛形（コメント 2 行）。macOS では `/etc/ssh/sshd_config.d/` に置く
5. **`docs/setup-mac.md`**：ゲストのユーザー名 = メールの `@` 前、という制約（Hanako・Jiro のアカウント名を決めるときに）
6. **`docs/verify.md` D-2 の UI 名**：Settings › Authentication › Login methods → 現在は Integrations › Identity providers
