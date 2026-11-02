#!/bin/bash
# claude remote-control のラッパー。com.example.claude-rc.plist の ProgramArguments から呼ばれる。
#
# やること（agent/src/actions/rc.ts の session_restore と対になる）:
#   1. ~/.config/macmini-agent/session.json（{"session_id": "..."}）があれば、その ID を読んでファイルを消し、
#      `claude remote-control --session-id <id>` で起動する。
#   2. 無ければ `claude remote-control` で起動する。
#   3. どちらも --debug-file ~/Library/Logs/claude-rc.log を付け、exec で claude に置き換わる
#      （launchd が追う PID = claude になり、kickstart -k の SIGTERM が claude に届く）。
#
# ファイルを先に消すのは、KeepAlive の再起動のたびに古いセッションを指し続けないため。エージェント側も
# 接続確認が終わった時点で消す（どちらが先でもよい）。
# ID は英数字・_・- の 1〜128 文字だけ受け付ける（rc.ts の SESSION_ID_PATTERN と同じ）。それ以外は無視する。
#
# 作業フォルダは plist の WorkingDirectory（cd しない）。HOME・PATH・LANG も plist から受け取る。
# 要確認（docs/verify.md C-2）: --session-id の取り方と、停止→再起動でセッションが戻るか。
set -u

CLAUDE_BIN="${CLAUDE_BIN:-$HOME/.local/bin/claude}"
DEBUG_LOG="${CLAUDE_RC_DEBUG_LOG:-$HOME/Library/Logs/claude-rc.log}"
SESSION_FILE="${MACMINI_AGENT_SESSION_FILE:-$HOME/.config/macmini-agent/session.json}"
RC_SETTINGS="${MACMINI_AGENT_RC_SETTINGS:-$HOME/.config/macmini-agent/rc.json}"

# 権限モード（docs/spec.md 13章 #18）。rc.json の permission_mode。無い・不正なら bypassPermissions（この Mac は Claude 専用）。
# ダッシュボードの「権限の確認を省く」がこのファイルを書き換え、RC を立て直す（agent/src/actions/rc.ts）。
perm_mode="bypassPermissions"
if [ -f "$RC_SETTINGS" ]; then
  m=$(sed -n 's/.*"permission_mode"[[:space:]]*:[[:space:]]*"\(bypassPermissions\|default\)".*/\1/p' "$RC_SETTINGS" | head -1)
  [ -n "$m" ] && perm_mode="$m"
fi

if [ ! -x "$CLAUDE_BIN" ]; then
  echo "claude-rc.sh: $CLAUDE_BIN が無い（which claude で確認し、plist か CLAUDE_BIN を直す）" >&2
  exit 1
fi

session_id=""
if [ -f "$SESSION_FILE" ]; then
  session_id=$(sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([A-Za-z0-9_-]\{1,128\}\)".*/\1/p' "$SESSION_FILE" | head -1)
  rm -f "$SESSION_FILE"
fi

if [ -n "$session_id" ]; then
  echo "claude-rc.sh: セッションを指定して起動する" >&2
  exec "$CLAUDE_BIN" remote-control --session-id "$session_id" --permission-mode "$perm_mode" --debug-file "$DEBUG_LOG"
fi
exec "$CLAUDE_BIN" remote-control --permission-mode "$perm_mode" --debug-file "$DEBUG_LOG"
