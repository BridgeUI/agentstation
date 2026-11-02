# launchd の plist テンプレート

| ファイル | 種別 | 置く場所 | 置く環境 |
| --- | --- | --- | --- |
| `com.cloudflare.cloudflared.plist` | LaunchDaemon（root） | `/Library/LaunchDaemons/` | host |
| `com.example.agent.plist` | LaunchAgent | `~/Library/LaunchAgents/` | host / vm1 / vm2（`__ENV__` を変える） |
| `com.example.tart-vm1.plist` / `com.example.tart-vm2.plist` | LaunchAgent | `~/Library/LaunchAgents/` | host |
| `com.example.claude-rc.plist` | LaunchAgent | `~/Library/LaunchAgents/` | host / vm1 / vm2 |
| `claude-rc.sh` | 上の plist が呼ぶラッパー（`session.json` があれば `--session-id` を付ける） | リポジトリの場所のまま使う（`~/workspace/macmini-dashboard/mac/launchd/claude-rc.sh`） | host / vm1 / vm2 |
| `com.example.codex.plist` | LaunchAgent | `~/Library/LaunchAgents/` | **未確認（docs/verify.md C-5）。確認が取れるまで配置しない** |

ラベルは `com.example.<名前>`（cloudflared だけ公式の `com.cloudflare.cloudflared`）。VM のラベル `com.example.tart-vm1/2` はエージェントの既定値（`agent/src/config.ts` の `DEFAULT_LABELS`）に合わせてある。

## プレースホルダ

| プレースホルダ | 意味 | 例 |
| --- | --- | --- |
| `__USER__` | その環境のログインユーザー名（Access のメールの @ より前） | `taro` / `hanako` / `jiro` |
| `__ENV__` | エージェントの `--env` | `host` / `vm1` / `vm2` |
| `__CODEX_ARGS__` | Codex の常駐用サブコマンド（要確認 C-5） | ー |

置換は `sed` で行い、置換後に `plutil -lint` を通す。例（host の Taro）：

```bash
mkdir -p ~/Library/LaunchAgents ~/Library/Logs/macmini-agent ~/Library/Logs/macmini-vm
sed -e "s/__USER__/$(whoami)/g" -e "s/__ENV__/host/g" com.example.agent.plist > ~/Library/LaunchAgents/com.example.agent.plist
sed -e "s/__USER__/$(whoami)/g" com.example.claude-rc.plist > ~/Library/LaunchAgents/com.example.claude-rc.plist
sed -e "s/__USER__/$(whoami)/g" com.example.tart-vm1.plist > ~/Library/LaunchAgents/com.example.tart-vm1.plist
sed -e "s/__USER__/$(whoami)/g" com.example.tart-vm2.plist > ~/Library/LaunchAgents/com.example.tart-vm2.plist
plutil -lint ~/Library/LaunchAgents/com.example.*.plist
grep -l "__" ~/Library/LaunchAgents/com.example.*.plist || echo "置換漏れなし"
```

VM（vm1 の Hanako）では `--env=vm1` にし、tart-vm のファイルは置かない：

```bash
sed -e "s/__USER__/$(whoami)/g" -e "s/__ENV__/vm1/g" com.example.agent.plist > ~/Library/LaunchAgents/com.example.agent.plist
sed -e "s/__USER__/$(whoami)/g" com.example.claude-rc.plist > ~/Library/LaunchAgents/com.example.claude-rc.plist
```

cloudflared（host、root）：

```bash
sudo mkdir -p /Library/Logs/cloudflared /etc/cloudflared
sudo cp com.cloudflare.cloudflared.plist /Library/LaunchDaemons/com.cloudflare.cloudflared.plist
sudo chown root:wheel /Library/LaunchDaemons/com.cloudflare.cloudflared.plist
sudo chmod 644 /Library/LaunchDaemons/com.cloudflare.cloudflared.plist
sudo plutil -lint /Library/LaunchDaemons/com.cloudflare.cloudflared.plist
```

## claude-rc.sh（Remote Control のラッパー）

`com.example.claude-rc.plist` は `claude` を直接ではなく `claude-rc.sh` を起動する。ラッパーは `~/.config/macmini-agent/session.json`（エージェントの `session_restore` が書く。`{"session_id": "..."}`）があれば ID を読んでファイルを消し、`--session-id` を付けて `claude remote-control --debug-file ~/Library/Logs/claude-rc.log` を `exec` する。無ければそのまま起動する。ファイルはリポジトリの checkout（`~/workspace/macmini-dashboard`）をそのまま使うので、コピーは不要（`git pull` で更新される）。

- `claude` の場所が `~/.local/bin/claude` でないときは plist の `EnvironmentVariables` に `CLAUDE_BIN` を足す
- `--session-id` の挙動は要確認（docs/verify.md C-2）

## 起動・停止・再起動

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.example.agent.plist
launchctl print gui/$(id -u)/com.example.agent | grep -E "state|pid"
launchctl kickstart -k gui/$(id -u)/com.example.agent
launchctl bootout gui/$(id -u)/com.example.agent
```

```bash
sudo launchctl bootstrap system /Library/LaunchDaemons/com.cloudflare.cloudflared.plist
sudo launchctl print system/com.cloudflare.cloudflared | grep -E "state|pid"
sudo launchctl kickstart -k system/com.cloudflare.cloudflared
```

plist を書き換えたときは `bootout` → `bootstrap` の順でやり直す（`kickstart` では plist を読み直さない）。

## `cloudflared service install` との違い

`sudo cloudflared service install` でも `/Library/LaunchDaemons/com.cloudflare.cloudflared.plist` が作られる。違いは次のとおり（要確認：手元の cloudflared のバージョンで実際に生成される plist を見て比べる）。

| 項目 | このテンプレート | `cloudflared service install` |
| --- | --- | --- |
| 設定の持ち方 | ローカルの `/etc/cloudflared/config.yml`（リポジトリで管理。`cloudflare/cloudflared/setup.md` と `config.yml.example`） | トークン付きで実行するとリモート管理（ダッシュボード側の設定）。トークン無しなら `~/.cloudflared/config.yml` を `/etc/cloudflared/` にコピーする |
| ログ | `/Library/Logs/cloudflared/cloudflared.{out,err}.log` | `/Library/Logs/com.cloudflare.cloudflared.{out,err}.log` |
| 更新 | `brew upgrade cloudflared` → `sudo launchctl kickstart -k system/com.cloudflare.cloudflared`（Taro が手動） | 同左 |

本プロジェクトは「ローカル設定ファイル」で動かす（docs/spec.md 3.4、13章 #2）ので、こちらのテンプレートを使う。`service install` を先に実行してしまった場合は `sudo cloudflared service uninstall` で消してからこちらを置く。

## ログの置き場（newsyslog の対象）

| プロセス | ログ |
| --- | --- |
| cloudflared | `/Library/Logs/cloudflared/cloudflared.out.log`、`cloudflared.err.log` |
| エージェント | `~/Library/Logs/macmini-agent/out.log`、`err.log` |
| tart run | `~/Library/Logs/macmini-vm/vm1.out.log` など |
| claude remote-control | `~/Library/Logs/claude-rc.log`（`--debug-file`）、`claude-rc.out.log`、`claude-rc.err.log` |
| Codex | `~/Library/Logs/codex.out.log`、`codex.err.log` |

ローテーションは `mac/newsyslog.d/macmini.conf`。
