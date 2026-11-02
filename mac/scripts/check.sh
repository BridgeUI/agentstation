#!/bin/bash
# docs/setup-mac.md の項目を機械的に確認して OK / NG / SKIP / 要確認 を出す。引数なし。副作用なし。
# sudo が要る項目は `sudo -n`（パスワードを聞かない）で試し、権限が無ければ SKIP にする。
# 先に `sudo -v` しておくと sudo の項目も確認できる。
#
# 環境（host / vm1 / vm2）は ~/Library/LaunchAgents/com.example.agent.plist の --env= から判定する。
# 出力の各行: 「OK   項目」「NG   項目: 詳細」「SKIP 項目: 理由」「要確認 項目: 理由」
set -u

ok=0; ng=0; skip=0; ask=0
OK()   { echo "OK    $1"; ok=$((ok+1)); }
NG()   { echo "NG    $1: $2"; ng=$((ng+1)); }
SKIP() { echo "SKIP  $1: $2"; skip=$((skip+1)); }
ASK()  { echo "要確認 $1: $2"; ask=$((ask+1)); }
H()    { echo; echo "## $1"; }

ME=$(whoami)
HOME_DIR=${HOME:-/Users/$ME}
UID_NUM=$(id -u)
AGENT_PLIST="$HOME_DIR/Library/LaunchAgents/com.example.agent.plist"

# ---- 環境の判定 ----
ENV_NAME=unknown
if [ -f "$AGENT_PLIST" ]; then
  ENV_NAME=$(grep -o -- '--env=[a-z0-9]*' "$AGENT_PLIST" | head -1 | sed 's/--env=//')
fi
case "$ENV_NAME" in
  host) EXPECT_USER=taro ;;
  vm1)  EXPECT_USER=hanako ;;
  vm2)  EXPECT_USER=jiro ;;
  *)    EXPECT_USER="" ;;
esac
echo "環境: $ENV_NAME（ユーザー: $ME、uid: $UID_NUM）"
if [ "$ENV_NAME" = unknown ]; then
  echo "com.example.agent.plist が無いか --env= が読めない。host として扱わず、host 限定の項目は SKIP にする。"
fi

can_sudo() { sudo -n true 2>/dev/null; }

# ---- 1. ユーザー名 ----
H "ユーザー名（Access のメールの @ より前と一致。docs/spec.md 3.2）"
if [ -n "$EXPECT_USER" ]; then
  [ "$ME" = "$EXPECT_USER" ] && OK "ユーザー名 $ME" || NG "ユーザー名" "$ME だが $ENV_NAME では $EXPECT_USER を想定"
else
  ASK "ユーザー名" "環境が判定できないので手で確認（taro / hanako / jiro）"
fi

# ---- 2. 自動ログイン・FileVault ----
H "自動ログインと FileVault（spec 3.2、verify A-2）"
fv=$(fdesetup status 2>/dev/null)
case "$fv" in
  *"is Off"*) OK "FileVault オフ" ;;
  *"is On"*)  NG "FileVault" "オン。自動ログインが使えない（13章 #1）" ;;
  *)          SKIP "FileVault" "fdesetup の出力が読めない: $fv" ;;
esac
alu=$(defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser 2>/dev/null)
if [ -n "$alu" ]; then
  [ "$alu" = "$ME" ] && OK "自動ログイン: $alu" || NG "自動ログイン" "$alu になっている（$ME を想定）"
else
  NG "自動ログイン" "未設定（システム設定 › ユーザとグループ › 自動ログイン）"
fi

# ---- 3. pmset ----
H "電源・スリープ（spec 3.2、mac/scripts/pmset-setup.sh）"
pm=$(pmset -g 2>/dev/null)
pmval() { echo "$pm" | awk -v k="$1" '$1==k {print $2; exit}'; }
check_pm() {
  v=$(pmval "$1")
  if [ -z "$v" ]; then SKIP "pmset $1" "この環境に無い（VM ゲストなら無視してよい）"
  elif [ "$v" = "$2" ]; then OK "pmset $1 = $v"
  else NG "pmset $1" "$v（期待 $2）"; fi
}
check_pm sleep 0
check_pm disksleep 0
check_pm autorestartatconnect 1
check_pm powernap 0
check_pm womp 1
dv=$(pmval displaysleep); [ -n "$dv" ] && OK "pmset displaysleep = $dv（任意）" || SKIP "pmset displaysleep" "無し"

# ---- 4. 自動更新 ----
H "自動更新オフ（spec 3.2）"
su=$(softwareupdate --schedule 2>/dev/null)
case "$su" in
  *"off"*) OK "softwareupdate --schedule off" ;;
  *"on"*)  NG "softwareupdate --schedule" "on（sudo softwareupdate --schedule off）" ;;
  *)       SKIP "softwareupdate --schedule" "出力が読めない: $su" ;;
esac
ASK "macOS の自動アップデート（画面）" "システム設定 › 一般 › ソフトウェアアップデート › 自動アップデート で「macOS アップデートをインストール」がオフか目で確認"
if grep -qs "HOMEBREW_NO_AUTO_UPDATE=1" "$HOME_DIR/.zprofile" "$HOME_DIR/.zshrc" 2>/dev/null; then
  OK "HOMEBREW_NO_AUTO_UPDATE=1（.zprofile/.zshrc）"
else
  NG "HOMEBREW_NO_AUTO_UPDATE" "~/.zprofile に export HOMEBREW_NO_AUTO_UPDATE=1 が無い"
fi
cs="$HOME_DIR/.claude/settings.json"
if [ -f "$cs" ]; then
  if grep -q '"DISABLE_AUTOUPDATER"[[:space:]]*:[[:space:]]*"1"' "$cs" && grep -q '"autoUpdatesChannel"[[:space:]]*:[[:space:]]*"stable"' "$cs"; then
    OK "~/.claude/settings.json に DISABLE_AUTOUPDATER=1 と autoUpdatesChannel=stable"
  else
    NG "~/.claude/settings.json" "mac/claude/settings.fragment.json をマージする"
  fi
else
  NG "~/.claude/settings.json" "無い"
fi

# ---- 5. タイムゾーン・ネットワーク ----
H "タイムゾーンとネットワーク（spec 3.2）"
tz=$(readlink /etc/localtime 2>/dev/null)
case "$tz" in *Asia/Tokyo*) OK "タイムゾーン Asia/Tokyo" ;; *) NG "タイムゾーン" "$tz（sudo systemsetup -settimezone Asia/Tokyo）" ;; esac
if [ "$ENV_NAME" = host ]; then
  if ifconfig en0 2>/dev/null | grep -q "status: active"; then OK "en0 がアクティブ（有線 LAN 想定。要確認: en0 が有線か）"; else ASK "有線 LAN" "en0 が active でない。システム設定 › ネットワーク で有線を確認"; fi
fi
ASK "DHCP 予約" "ルーター側の設定なので手で確認（verify A-6）"

# ---- 6. SSH と画面共有 ----
H "リモートログインと画面共有（spec 8章）"
nc -z -w 2 127.0.0.1 22 >/dev/null 2>&1 && OK "sshd が 22 で待ち受け" || NG "リモートログイン" "22 が閉じている（システム設定 › 一般 › 共有 › リモートログイン）"
nc -z -w 2 127.0.0.1 5900 >/dev/null 2>&1 && OK "画面共有が 5900 で待ち受け" || NG "画面共有" "5900 が閉じている（システム設定 › 一般 › 共有 › 画面共有）"
ASK "VNC パスワード方式" "画面共有 ⓘ の「VNC ビューアがパスワードで画面を制御することを許可」は画面で確認（verify B-5 / D-5）"
if [ -f /etc/ssh/sshd_config.d/50-cloudflare-access.conf ]; then
  OK "/etc/ssh/sshd_config.d/50-cloudflare-access.conf がある"
  [ -f /etc/ssh/ca.pub ] && OK "/etc/ssh/ca.pub がある" || NG "/etc/ssh/ca.pub" "無い（cloudflare/ の手順で取得）"
  if grep -qs "^Include /etc/ssh/sshd_config.d/" /etc/ssh/sshd_config; then OK "sshd_config が sshd_config.d を Include"; else NG "sshd_config" "Include /etc/ssh/sshd_config.d/* が無い"; fi
  if can_sudo; then sudo -n sshd -t 2>/dev/null && OK "sshd -t（設定の文法）" || NG "sshd -t" "エラー（sudo sshd -t で詳細）"; else SKIP "sshd -t" "sudo が要る"; fi
else
  SKIP "sshd の Access 断片" "未配置（フェーズ7で入れる）"
fi

# ---- 7. ツール ----
H "ツールの絶対パス（plist が参照する。spec 3.1）"
[ -x "$HOME_DIR/.nodebrew/current/bin/node" ] && OK "node: $HOME_DIR/.nodebrew/current/bin/node ($("$HOME_DIR/.nodebrew/current/bin/node" -v))" || NG "node" "$HOME_DIR/.nodebrew/current/bin/node が無い"
[ -x "$HOME_DIR/.local/bin/claude" ] && OK "claude: $HOME_DIR/.local/bin/claude" || NG "claude" "$HOME_DIR/.local/bin/claude が無い（which claude で場所を確認し plist の CLAUDE_BIN を直す）"
[ -x "$HOME_DIR/workspace/macmini-dashboard/mac/launchd/claude-rc.sh" ] && OK "claude-rc.sh（ラッパー）がある" || NG "claude-rc.sh" "$HOME_DIR/workspace/macmini-dashboard/mac/launchd/claude-rc.sh が無いか実行権が無い"
if [ "$ENV_NAME" = host ]; then
  [ -x /opt/homebrew/bin/tart ] && OK "tart: /opt/homebrew/bin/tart" || NG "tart" "/opt/homebrew/bin/tart が無い"
  [ -x /opt/homebrew/bin/cloudflared ] && OK "cloudflared: /opt/homebrew/bin/cloudflared" || NG "cloudflared" "/opt/homebrew/bin/cloudflared が無い"
fi
command -v codex >/dev/null 2>&1 && OK "codex: $(command -v codex)" || SKIP "codex" "未導入（要確認 verify C-5）"

# ---- 8. Claude の作業フォルダ ----
H "claude remote-control の作業フォルダ（spec 3.1）"
[ -d "$HOME_DIR/work/rc" ] && OK "$HOME_DIR/work/rc がある" || NG "作業フォルダ" "$HOME_DIR/work/rc が無い（ホーム直下・Desktop・Documents は不可）"
ASK "作業フォルダの信頼" "一度 claude を対話的に起動して信頼したか（claude-rc.err.log に Workspace not trusted が無いこと。verify C-1）"

# ---- 9. エージェントの設定 ----
H "エージェントの設定（agent/src/config.ts）"
cfgdir="$HOME_DIR/.config/macmini-agent"
[ -f "$cfgdir/config.json" ] && OK "config.json がある" || NG "config.json" "$cfgdir/config.json が無い"
if [ -f "$cfgdir/token.json" ]; then
  mode=$(stat -f %Lp "$cfgdir/token.json" 2>/dev/null)
  [ "$mode" = "600" ] && OK "token.json の権限 600" || NG "token.json" "権限が $mode（chmod 600）"
else
  NG "token.json" "$cfgdir/token.json が無い"
fi
if [ -f "$cfgdir/config.json" ]; then
  for k in base_url claude_path; do grep -q "\"$k\"" "$cfgdir/config.json" && OK "config.json: $k" || NG "config.json" "$k が無い"; done
  if [ "$ENV_NAME" = host ]; then grep -q '"tart_path"' "$cfgdir/config.json" && OK "config.json: tart_path" || NG "config.json" "host には tart_path が必要"; fi
fi
[ -f "$HOME_DIR/workspace/macmini-dashboard/agent/dist/index.js" ] && OK "agent/dist/index.js がある" || NG "agent/dist/index.js" "無い（npm run build --workspace agent）"

# ---- 10. launchd ----
H "launchd（state = running を期待）"
check_agent() {
  label=$1; plist="$HOME_DIR/Library/LaunchAgents/$label.plist"
  if [ ! -f "$plist" ]; then NG "$label" "plist が無い"; return; fi
  grep -q "__" "$plist" && NG "$label" "plist にプレースホルダ（__）が残っている"
  plutil -lint "$plist" >/dev/null 2>&1 || NG "$label" "plutil -lint が失敗"
  st=$(launchctl print "gui/$UID_NUM/$label" 2>/dev/null | awk '/^\tstate = /{print $3; exit}')
  if [ "$st" = running ]; then OK "$label: running"
  elif [ -z "$st" ]; then NG "$label" "読み込まれていない（launchctl bootstrap gui/$UID_NUM $plist）"
  else NG "$label" "state = $st"; fi
}
check_agent com.example.agent
check_agent com.example.claude-rc
if [ "$ENV_NAME" = host ]; then
  # VM は 0〜2 台。plist を置いていない VM は使っていないものとして飛ばす
  for vm in vm1 vm2; do
    if [ -f "$HOME_DIR/Library/LaunchAgents/com.example.tart-$vm.plist" ]; then check_agent "com.example.tart-$vm"
    else SKIP "com.example.tart-$vm" "未配置（この VM は使っていない）"; fi
  done
fi
if [ -f "$HOME_DIR/Library/LaunchAgents/com.example.codex.plist" ]; then check_agent com.example.codex; else SKIP "com.example.codex" "未配置（要確認 verify C-5）"; fi
if [ "$ENV_NAME" = host ]; then
  if [ -f /Library/LaunchDaemons/com.cloudflare.cloudflared.plist ]; then
    if can_sudo; then
      st=$(sudo -n launchctl print system/com.cloudflare.cloudflared 2>/dev/null | awk '/^\tstate = /{print $3; exit}')
      [ "$st" = running ] && OK "com.cloudflare.cloudflared: running" || NG "com.cloudflare.cloudflared" "state = ${st:-未読み込み}"
    else
      pgrep -q -f "cloudflared tunnel" && OK "cloudflared のプロセスがある（state は sudo で確認）" || NG "cloudflared" "プロセスが無い"
    fi
    [ -f /etc/cloudflared/config.yml ] && OK "/etc/cloudflared/config.yml がある" || NG "/etc/cloudflared/config.yml" "無い（cloudflare/ 参照）"
  else
    NG "com.cloudflare.cloudflared" "/Library/LaunchDaemons に plist が無い"
  fi
fi

# ---- 11. sudoers ----
if [ "$ENV_NAME" = host ]; then
  H "sudoers（host_restart 用。spec 6章）"
  if [ -f /etc/sudoers.d/macmini-agent ] || sudo -n test -f /etc/sudoers.d/macmini-agent 2>/dev/null; then
    if can_sudo; then
      sudo -n visudo -cf /etc/sudoers.d/macmini-agent >/dev/null 2>&1 && OK "visudo -cf /etc/sudoers.d/macmini-agent" || NG "sudoers" "visudo -cf が失敗"
      sudo -n -l /sbin/shutdown -r now >/dev/null 2>&1 && OK "sudo -n /sbin/shutdown -r now が許可されている" || NG "sudoers" "shutdown -r now が NOPASSWD になっていない"
    else
      SKIP "sudoers の検証" "sudo が要る（sudo -v してから再実行）"
    fi
  else
    NG "sudoers" "/etc/sudoers.d/macmini-agent が無い"
  fi
fi

# ---- 12. newsyslog ----
H "ログローテーション（mac/newsyslog.d）"
if [ -f /etc/newsyslog.d/macmini.conf ]; then
  grep -q "__" /etc/newsyslog.d/macmini.conf && NG "newsyslog" "プレースホルダが残っている" || OK "/etc/newsyslog.d/macmini.conf がある"
else
  NG "newsyslog" "/etc/newsyslog.d/macmini.conf が無い"
fi
for d in "$HOME_DIR/Library/Logs/macmini-agent"; do [ -d "$d" ] && OK "ログ用フォルダ $d" || NG "ログ用フォルダ" "$d が無い（mkdir -p）"; done

# ---- 13. Time Machine / Spotlight ----
if [ "$ENV_NAME" = host ]; then
  H "~/.tart の除外（spec 3.2）"
  if [ -d "$HOME_DIR/.tart" ]; then
    tm=$(tmutil isexcluded "$HOME_DIR/.tart" 2>/dev/null)
    case "$tm" in *"[Excluded]"*) OK "Time Machine から ~/.tart を除外" ;; *) NG "Time Machine" "~/.tart が除外されていない（tmutil addexclusion ~/.tart）" ;; esac
  else
    SKIP "Time Machine の除外" "~/.tart が無い"
  fi
  ASK "Spotlight の除外" "システム設定 › Siri と Spotlight › Spotlight のプライバシー（名称は要確認）に ~/.tart があるか目で確認"
fi

# ---- 14. ディスク ----
H "ディスク（spec 5章: 85% 注意、90% 異常）"
used=$(df -P / | awk 'NR==2 {gsub("%","",$5); print $5}')
if [ -n "$used" ]; then
  if [ "$used" -lt 85 ]; then OK "ディスク使用率 ${used}%"; elif [ "$used" -lt 90 ]; then NG "ディスク使用率" "${used}%（注意）"; else NG "ディスク使用率" "${used}%（異常）"; fi
fi

echo
echo "== 集計: OK $ok / NG $ng / SKIP $skip / 要確認 $ask"
[ "$ng" -eq 0 ] && exit 0 || exit 1
