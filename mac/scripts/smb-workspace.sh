#!/bin/bash
# そのマシンの利用者の ~/workspace を SMB で共有し、iPhone の「ファイル」アプリから
# WARP 経由（smb://<内部IP>/workspace）で開けるようにする。host / vm1 / vm2 共通。
#
# 使い方
#   host（Taro 本人。パスワードを聞かれる）:
#     sudo bash mac/scripts/smb-workspace.sh
#   vm1 / vm2（host から。パスワードは ~/.config/macmini-agent/<env>-secrets の USER_PW を標準入力で渡す）:
#     scp mac/scripts/smb-workspace.sh admin@192.168.64.10:/tmp/
#     sed -n 's/^USER_PW=//p' ~/.config/macmini-agent/vm1-secrets | ssh admin@192.168.64.10 'sudo bash /tmp/smb-workspace.sh hanako; rm /tmp/smb-workspace.sh'
#   引数：[ユーザー名] [共有するフォルダ]。省略時はユーザー名が sudo を実行した人（$SUDO_USER）、フォルダが ~/workspace
#   パスワードの渡し方：環境変数 USER_PW → 標準入力が端末でなければ 1 行読む → 端末なら対話で聞く
#
# やること
#   1. ユーザーの SMB-NT ハッシュを有効化（既定では無く、SMB ログインに失敗する）。
#      ハッシュは「パスワードを設定し直したとき」に作られるので、現在のパスワードを受け取り、
#      同じパスワードで設定し直す（先に認証して誤りは弾く。パスワードは変わらない）。
#      System Settings › 共有 › ファイル共有 › オプション でユーザーをオンにするときに
#      パスワードを聞かれるのと同じこと。
#   2. ファイル共有（smbd）を有効にして起動
#   3. 共有ポイント `workspace` を追加（ゲスト不可、読み書き可）
# 秘密情報は表示しない（set -x は使わない）。
#
# 戻すとき
#   sudo sharing -r workspace
#   sudo launchctl unload -w /System/Library/LaunchDaemons/com.apple.smbd.plist
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "sudo で実行してください" >&2
  exit 1
fi

USER_NAME="${1:-${SUDO_USER:-}}"
if [ -z "$USER_NAME" ] || [ "$USER_NAME" = root ]; then
  echo "共有を使うユーザー名を引数で指定してください" >&2
  exit 1
fi
HOME_DIR=$(dscl . -read "/Users/$USER_NAME" NFSHomeDirectory | awk '{print $2}')
SHARE_PATH="${2:-$HOME_DIR/workspace}"
SHARE_NAME=$(basename "$SHARE_PATH")

[ -d "$SHARE_PATH" ] || { echo "フォルダがありません: $SHARE_PATH" >&2; exit 1; }

echo "== 1. $USER_NAME の SMB-NT ハッシュ"
if pwpolicy -u "$USER_NAME" -gethashtypes 2>/dev/null | grep -q SMB-NT; then
  echo "すでに有効"
else
  pwpolicy -u "$USER_NAME" -sethashtypes SMB-NT on >/dev/null
  PW="${USER_PW:-}"
  if [ -n "$PW" ]; then
    dscl /Local/Default -authonly "$USER_NAME" "$PW" 2>/dev/null || { echo "USER_PW が $USER_NAME のパスワードと違う" >&2; exit 1; }
  elif [ ! -t 0 ]; then
    IFS= read -r PW || true
    dscl /Local/Default -authonly "$USER_NAME" "$PW" 2>/dev/null || { echo "標準入力のパスワードが $USER_NAME のパスワードと違う" >&2; exit 1; }
  else
    echo "$USER_NAME の現在の Mac のログインパスワードを入力（同じパスワードで設定し直してハッシュを作る）"
    for _ in 1 2 3; do
      read -r -s -p "パスワード: " PW; echo
      if dscl /Local/Default -authonly "$USER_NAME" "$PW" 2>/dev/null; then
        break
      fi
      echo "違います。もう一度" >&2
      PW=""
    done
    [ -n "${PW:-}" ] || { echo "認証に 3 回失敗。中止" >&2; exit 1; }
  fi
  dscl . -passwd "/Users/$USER_NAME" "$PW" "$PW"
  unset PW
  if pwpolicy -u "$USER_NAME" -gethashtypes | grep -q SMB-NT; then
    echo "有効になった"
  else
    echo "SMB-NT ハッシュが作れなかった。System Settings › 一般 › 共有 › ファイル共有 (i) › オプション › $USER_NAME をオンにしてパスワードを入れる" >&2
  fi
fi

echo "== 2. ファイル共有（smbd）を有効化"
defaults write /Library/Preferences/SystemConfiguration/com.apple.smb.server EnabledServices -array disk
# 2 回目以降は「Load failed: 5: Input/output error」（すでに読み込み済み）になるので無視する
launchctl load -w /System/Library/LaunchDaemons/com.apple.smbd.plist 2>/dev/null || true
launchctl kickstart -k system/com.apple.smbd 2>/dev/null || true

echo "== 3. 共有ポイント $SHARE_NAME ($SHARE_PATH)"
if sharing -l | grep -q "^path:[[:space:]]*$SHARE_PATH\$"; then
  echo "すでに共有済み"
  # システム設定から作った共有はゲストが許可されていることがある（host で実際にあった）。ゲスト不可にそろえる
  if sharing -l | sed -n "/name:[[:space:]]*$SHARE_NAME\$/,/}/p" | grep -q 'guest access:[[:space:]]*1'; then
    sharing -e "$SHARE_NAME" -g 000
    echo "ゲストアクセスをオフにした"
  fi
else
  sharing -a "$SHARE_PATH" -S "$SHARE_NAME" -s 001 -g 000
fi

echo "== 確認"
ok=""
for _ in $(seq 1 10); do
  if netstat -an | grep -q '\.445 .*LISTEN'; then ok=1; break; fi
  sleep 1
done
if [ -n "$ok" ]; then
  echo "smbd が 445 で待受中"
else
  echo "445 が LISTEN していない。launchctl print system/com.apple.smbd と netstat -an | grep 445 で確認" >&2
fi
sharing -l | sed -n "/name:[[:space:]]*$SHARE_NAME\$/,/}/p"
echo
echo "iPhone：ファイル › … › サーバへ接続 › smb://<このマシンの内部IP> › 登録ユーザ $USER_NAME / Mac のログインパスワード › $SHARE_NAME"
