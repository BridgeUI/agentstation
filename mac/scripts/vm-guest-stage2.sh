#!/bin/bash
# VM ゲストの基礎設定・第 2 段（docs/setup-mac.md 3 / 5 / 6 / 8.3）。ゲストの中で、利用者（hanako / jiro）として実行する。
#
#   ssh hanako@<vm の IP> 'GUEST_ENV=vm1 bash -s' < mac/scripts/vm-guest-stage2.sh
#
# 先に host から置いておくもの:
#   ~/workspace/macmini-dashboard          リポジトリ（rsync。node_modules と dist は不要）
#   ~/.config/macmini-agent/token.json     その VM のサービストークン（chmod 600）
#
# やること: nodebrew と Node 24、Claude Code（ネイティブ版）、Claude の settings.json（自動更新オフ）、
#           エージェントのビルドと config.json、launchd（エージェント・claude-rc）。
# やらないこと: Claude のログイン、作業フォルダの信頼、Remote Control の初回同意（利用者が一度対話で行う。5.2）。
set -euo pipefail
: "${GUEST_ENV:?GUEST_ENV（vm1 / vm2）が必要}"
ME="$(whoami)"
step() { printf '\n== %s\n' "$1"; }

mkdir -p ~/workspace ~/Library/LaunchAgents ~/Library/Logs/macmini-agent ~/.config/macmini-agent ~/.claude
chmod 700 ~/.config/macmini-agent
[ -f ~/.config/macmini-agent/token.json ] || { echo "token.json が無い" >&2; exit 1; }
chmod 600 ~/.config/macmini-agent/token.json

step "nodebrew と Node 24"
if [ ! -x "$HOME/.nodebrew/current/bin/node" ]; then
  curl -fsSL https://raw.githubusercontent.com/hokaccha/nodebrew/master/nodebrew | perl - setup >/dev/null
  "$HOME/.nodebrew/current/bin/nodebrew" install-binary v24 >/dev/null
  "$HOME/.nodebrew/current/bin/nodebrew" use v24 >/dev/null
fi
grep -q nodebrew ~/.zprofile 2>/dev/null || echo 'export PATH=$HOME/.nodebrew/current/bin:$HOME/.local/bin:$PATH' >> ~/.zprofile
export PATH="$HOME/.nodebrew/current/bin:$HOME/.local/bin:$PATH"
node -v

step "Claude Code（ネイティブ版）"
if [ ! -x "$HOME/.local/bin/claude" ]; then
  curl -fsSL https://claude.ai/install.sh | bash >/dev/null
fi
"$HOME/.local/bin/claude" --version
if [ ! -f ~/.claude/settings.json ]; then
  cat > ~/.claude/settings.json <<'JSON'
{
  "env": {
    "DISABLE_AUTOUPDATER": "1"
  },
  "autoUpdatesChannel": "stable"
}
JSON
fi

step "エージェントのビルド"
cd ~/workspace/macmini-dashboard
npm ci --no-audit --no-fund >/dev/null
(cd agent && npm run build >/dev/null)
ls -la agent/dist/index.js

step "config.json"
if [ ! -f ~/.config/macmini-agent/config.json ]; then
  cat > ~/.config/macmini-agent/config.json <<JSON
{
  "base_url": "https://workstation.example.com",
  "claude_path": "/Users/$ME/.local/bin/claude",
  "work_dir": "/Users/$ME/workspace",
  "rc_debug_log": "/Users/$ME/Library/Logs/claude-rc.log",
  "labels": { "codex": null },
  "interval_ms": 60000
}
JSON
  chmod 600 ~/.config/macmini-agent/config.json
fi

step "launchd（エージェント・claude-rc）"
cd ~/workspace/macmini-dashboard/mac/launchd
sed -e "s/__USER__/$ME/g" -e "s/__ENV__/$GUEST_ENV/g" com.example.agent.plist > ~/Library/LaunchAgents/com.example.agent.plist
sed -e "s/__USER__/$ME/g" com.example.claude-rc.plist > ~/Library/LaunchAgents/com.example.claude-rc.plist
plutil -lint ~/Library/LaunchAgents/com.example.agent.plist ~/Library/LaunchAgents/com.example.claude-rc.plist
UID_="$(id -u)"
# この利用者が GUI にログインしていない（自動ログインは次の再起動から）と gui/<uid> が無く、bootstrap は 125 で失敗する。
# その場合は何もしない。再起動すると ~/Library/LaunchAgents は自動で読み込まれる。
if launchctl print "gui/$UID_" >/dev/null 2>&1; then
  launchctl bootout "gui/$UID_/com.example.agent" 2>/dev/null || true
  launchctl bootstrap "gui/$UID_" ~/Library/LaunchAgents/com.example.agent.plist
  # claude-rc は Claude にログインするまで起動と終了を繰り返す（ダッシュボードには「要ログイン」と出る）。
  launchctl bootout "gui/$UID_/com.example.claude-rc" 2>/dev/null || true
  launchctl bootstrap "gui/$UID_" ~/Library/LaunchAgents/com.example.claude-rc.plist
  sleep 3
  launchctl print "gui/$UID_/com.example.agent" | grep -E '^\s*(state|pid) '
  tail -3 ~/Library/Logs/macmini-agent/out.log 2>/dev/null || true
else
  echo "$ME は GUI にログインしていないので launchd には載せない（再起動後の自動ログインで自動的に読み込まれる）"
fi
echo "stage2 done"
