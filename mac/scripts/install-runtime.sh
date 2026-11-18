#!/bin/bash
# 常駐に使うファイルを、作業用のリポジトリの外（~/.local/share/agentstation）へ置く。
#
#   bash mac/scripts/install-runtime.sh            # 置くだけ（動いているエージェントは古いまま）
#   bash mac/scripts/install-runtime.sh --restart  # 置いてからエージェントを再起動する
#
# なぜ：launchd がリポジトリの checkout を直接指していると、作業フォルダを消す・移す・ブランチを
# 切り替えるだけで常駐が壊れる。しかも動いている間は気づけず、次の再起動で初めて起動に失敗する
# （2026-11-19、~/workspace/agentstation を消したあと再起動して EX_CONFIG(78) で止まった）。
#
# 置くもの（plist はここを指す。mac/launchd/*.plist）：
#   ~/.local/share/agentstation/agent/index.js   エージェント（esbuild で 1 ファイルにまとめたもの。依存なし）
#   ~/.local/share/agentstation/bin/claude-rc.sh メインの Remote Control のラッパー
#   ~/.local/share/agentstation/VERSION          どのコミットから置いたか
#
# 先に npm run build --workspace agent を済ませておく。置き換えは一時ファイルからの mv なので、
# 動いているエージェントや起動途中の launchd が書きかけのファイルを読むことはない。
# host でフォルダごとの RC から作業しているとき、--restart でその Claude のセッションも切れる
# （エージェントの子プロセスのため。kit/lessons.md）。
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEST="${AGENTSTATION_RUNTIME_DIR:-$HOME/.local/share/agentstation}"
LABEL=co.bridgeui.agentstation.agent
RESTART=0
for a in "$@"; do
  case "$a" in
    --restart) RESTART=1 ;;
    *) echo "使い方: $0 [--restart]" >&2; exit 2 ;;
  esac
done

SRC_AGENT="$REPO/agent/dist/index.js"
SRC_RC="$REPO/mac/launchd/claude-rc.sh"
[ -s "$SRC_AGENT" ] || { echo "$SRC_AGENT が無い（npm run build --workspace agent）" >&2; exit 1; }
[ -f "$SRC_RC" ] || { echo "$SRC_RC が無い" >&2; exit 1; }

mkdir -p "$DEST/agent" "$DEST/bin"

put() { # put <元> <先> <mode>
  local tmp="$2.tmp.$$"
  cp "$1" "$tmp"
  chmod "$3" "$tmp"
  mv -f "$tmp" "$2"
}
put "$SRC_AGENT" "$DEST/agent/index.js" 644
put "$SRC_RC" "$DEST/bin/claude-rc.sh" 755

rev="$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo unknown)"
dirty=""
[ -n "$(git -C "$REPO" status --porcelain 2>/dev/null)" ] && dirty=" (未コミットの変更あり)"
printf '%s%s %s\n' "$rev" "$dirty" "$(date '+%F %T %Z')" >"$DEST/VERSION.tmp.$$"
mv -f "$DEST/VERSION.tmp.$$" "$DEST/VERSION"

echo "置いた: $DEST（$(cat "$DEST/VERSION")）"

if [ "$RESTART" = 1 ]; then
  if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
    launchctl kickstart -k "gui/$(id -u)/$LABEL"
    echo "エージェントを再起動した"
  else
    echo "エージェント（$LABEL）は launchd に載っていない。plist を置いて bootstrap する（mac/launchd/README.md）"
  fi
fi
