# Mac 側の設定ファイル（テンプレート）

導入手順は `docs/setup-mac.md`。仕様は `docs/spec.md` 3章・6章・7章・8.2。未確認事項は `docs/verify.md`。

| パス | 内容 | 置く環境 |
| --- | --- | --- |
| `launchd/com.cloudflare.cloudflared.plist` | cloudflared の LaunchDaemon（root、`/etc/cloudflared/config.yml`） | host |
| `launchd/com.example.agent.plist` | エージェント。`__ENV__` を host / vm1 / vm2 に置換 | 3 環境 |
| `launchd/com.example.tart-vm1.plist` / `com.example.tart-vm2.plist` | `tart run --no-graphics` の LaunchAgent | host |
| `launchd/com.example.claude-rc.plist` | `claude remote-control --debug-file` の LaunchAgent（verify.md C-1 が正。ProgramArguments だけラッパー経由） | 3 環境 |
| `launchd/claude-rc.sh` | 上のラッパー。`~/.config/agentstation/session.json` があれば `--session-id` を付けて `exec`（`session_restore` 用） | 3 環境（リポジトリの場所のまま使う） |
| `launchd/com.example.codex.plist` | Codex の常駐（**要確認 C-5。確認まで配置しない**） | 3 環境 |
| `launchd/README.md` | プレースホルダの置換（sed）、bootstrap / kickstart、`cloudflared service install` との違い | ー |
| `sudoers.d/agentstation` | `shutdown -r now` だけ NOPASSWD | host |
| `newsyslog.d/agentstation.conf` | ログローテーション（50MB × 5 世代、bzip2） | 3 環境（VM は host 用の行を消す） |
| `sshd/50-cloudflare-access.conf` | `TrustedUserCAKeys /etc/ssh/ca.pub`、公開鍵認証。パスワード無効化の 2 行は証明書ログイン確認後にコメントを外す | 3 環境 |
| `claude/settings.fragment.json` | `DISABLE_AUTOUPDATER=1`、`autoUpdatesChannel: stable`。マージ手順は `claude/README.md` | 3 環境 |
| `scripts/pmset-setup.sh` | spec 3.2 の pmset を一括設定（副作用あり。sudo） | 3 環境 |
| `scripts/check.sh` | 手順書の項目を機械的に確認して OK / NG / SKIP / 要確認 を出す（副作用なし） | 3 環境 |

プレースホルダは `__USER__`（ユーザー名）、`__ENV__`（host / vm1 / vm2）、`__CODEX_ARGS__`（要確認）。置換後に `plutil -lint`（plist）、`visudo -cf`（sudoers）、`sshd -t`（sshd）、`newsyslog -nvv`（newsyslog）で検証する。

launchd のラベルと設定ファイルの置き場は `agent/src/config.ts` の既定値（`com.example.claude-rc`、`com.example.codex`、`com.example.tart-vm1/2`、`~/.config/agentstation/{config,token}.json`）に合わせてある。変えるときは両方を直す。
