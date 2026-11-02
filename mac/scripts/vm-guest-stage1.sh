#!/bin/bash
# VM ゲストの基礎設定・第 1 段（docs/setup-mac.md 4.2 / 付録 A）。ゲストの中で、イメージの既定ユーザー（admin、sudo はパスワード不要）として実行する。
#
#   ssh admin@<vm の IP> 'GUEST_USER=hanako GUEST_FULLNAME=Hanako GUEST_ENV=vm1 HOST_PUBKEY="ssh-ed25519 AAAA..." bash -s' < mac/scripts/vm-guest-stage1.sh
#
# 先に scp でホームに置いておくもの（終わったら消す）:
#   ~/.vm-secrets          USER_PW=... と VNC_PW=...（chmod 600。ホスト側は ~/.config/macmini-agent/<env>-secrets に保管）
#   ~/ca.pub               cloudflare/access/ca/ca.pub.<env>
#   ~/50-cloudflare-access.conf   mac/sshd/50-cloudflare-access.conf
#   ~/macmini.conf         mac/newsyslog.d/macmini.conf（__USER__ を置換し、host だけの区画を削ったもの）
#
# やること: 利用者ユーザーの作成（管理者）と自動ログイン、作業用 SSH 鍵、pmset、自動更新オフ、タイムゾーン、
#           ホスト名、画面共有（VNC パスワード方式）、sshd の Access CA、newsyslog。
# やらないこと: IP の固定（接続が切れるので最後に別で実行する。stage3）、Node / Claude / エージェント（stage2。利用者として実行）。
# 秘密情報は表示しない（set -x は使わない）。
set -euo pipefail

: "${GUEST_USER:?GUEST_USER（hanako / jiro）が必要}"
: "${GUEST_ENV:?GUEST_ENV（vm1 / vm2）が必要}"
: "${HOST_PUBKEY:?HOST_PUBKEY（host の公開鍵 1 行）が必要}"
GUEST_FULLNAME="${GUEST_FULLNAME:-$GUEST_USER}"
SECRETS="$HOME/.vm-secrets"
[ -f "$SECRETS" ] || { echo "$SECRETS が無い" >&2; exit 1; }
# shellcheck disable=SC1090
. "$SECRETS"
: "${USER_PW:?.vm-secrets に USER_PW が無い}" "${VNC_PW:?.vm-secrets に VNC_PW が無い}"

step() { printf '\n== %s\n' "$1"; }

step "利用者ユーザー $GUEST_USER（管理者）"
if id "$GUEST_USER" >/dev/null 2>&1; then
  echo "既にある"
else
  sudo sysadminctl -addUser "$GUEST_USER" -fullName "$GUEST_FULLNAME" -password "$USER_PW" -admin 2>&1 | grep -v -i password || true
fi
id "$GUEST_USER" >/dev/null

step "設定アシスタントをできるだけ飛ばす（既定ユーザーの完了済み記録をコピー）"
# 実機（macOS 26.6）では Apple ID・Siri などは飛ぶが「Update Mac Automatically」の 1 画面だけ残る（対応するキーが見つからない）。
# その画面は画面共有で「Only Download Automatically」→「Continue」を押す。
# 新しいユーザーの初回ログインでは設定アシスタント（Apple ID・Siri・自動更新…）が出て、終えるまでデスクトップに進めない。
# ベースイメージの admin は作成時に完了しているので、その com.apple.SetupAssistant.plist をそのまま置く。
HOME_DIR="/Users/$GUEST_USER"
if [ -f "$HOME/Library/Preferences/com.apple.SetupAssistant.plist" ]; then
  sudo mkdir -p "$HOME_DIR/Library/Preferences"
  sudo cp "$HOME/Library/Preferences/com.apple.SetupAssistant.plist" "$HOME_DIR/Library/Preferences/com.apple.SetupAssistant.plist"
  sudo chown -R "$GUEST_USER:staff" "$HOME_DIR/Library"
  echo "copied"
else
  echo "$HOME に com.apple.SetupAssistant.plist が無い（初回ログインで設定アシスタントが出る。画面共有で進める）"
fi

step "自動ログイン"
# SSH 経由の sysadminctl -autologin set は autoLoginUser は書くが /etc/kcpassword を書かない（SACSetAutoLoginPassword error:22。実機 vm1）。
# そのため kcpassword（11 バイトの固定鍵で XOR、12 バイト境界までゼロ埋め）を直接書く。
sudo sysadminctl -autologin set -userName "$GUEST_USER" -password "$USER_PW" 2>&1 | grep -v -i -E "password|error:22" || true
sudo defaults write /Library/Preferences/com.apple.loginwindow autoLoginUser -string "$GUEST_USER"
printf "%s" "$USER_PW" | sudo perl -e 'my @k=(0x7D,0x89,0x52,0x23,0xD2,0xBC,0xDD,0xEA,0xA3,0xB9,0x1F); local $/; my $p=<STDIN>; my @b=unpack("C*",$p); push @b,0 while @b % 12; open(my $f,">","/etc/kcpassword") or die; binmode $f; print $f join("",map{chr($b[$_]^$k[$_%11])}0..$#b); close $f; chmod 0600,"/etc/kcpassword";'
defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser
sudo ls -l /etc/kcpassword

step "作業用の SSH 鍵（host → $GUEST_USER。設定が終わったら外してよい）"
HOME_DIR="/Users/$GUEST_USER"
sudo mkdir -p "$HOME_DIR/.ssh"
echo "$HOST_PUBKEY" | sudo tee "$HOME_DIR/.ssh/authorized_keys" >/dev/null
sudo chmod 700 "$HOME_DIR/.ssh"
sudo chmod 600 "$HOME_DIR/.ssh/authorized_keys"
sudo chown -R "$GUEST_USER:staff" "$HOME_DIR/.ssh"

step "pmset（VM では autorestartatconnect / womp が無いことがある）"
sudo pmset -a sleep 0 disksleep 0 displaysleep 0 powernap 0 || true
pmset -g | grep -E ' sleep|disksleep|powernap'

step "自動更新オフ"
for k in AutomaticCheckEnabled AutomaticDownload AutomaticallyInstallMacOSUpdates CriticalUpdateInstall ConfigDataInstall; do
  sudo defaults write /Library/Preferences/com.apple.SoftwareUpdate "$k" -bool false
done
sudo defaults write /Library/Preferences/com.apple.commerce AutoUpdate -bool false
sudo softwareupdate --schedule off >/dev/null 2>&1 || true

step "タイムゾーン・時刻同期"
sudo systemsetup -settimezone Asia/Tokyo >/dev/null
sudo systemsetup -setusingnetworktime on >/dev/null
sudo systemsetup -gettimezone

step "ホスト名 $GUEST_ENV"
sudo scutil --set ComputerName "$GUEST_ENV"
sudo scutil --set LocalHostName "$GUEST_ENV"
sudo scutil --set HostName "$GUEST_ENV"

step "リモートログイン・画面共有（VNC パスワード方式）"
sudo systemsetup -setremotelogin on >/dev/null 2>&1 || echo "（setremotelogin は Full Disk Access が無いと失敗する。SSH で入れているなら既にオン）"
KICK=/System/Library/CoreServices/RemoteManagement/ARDAgent.app/Contents/Resources/kickstart
sudo "$KICK" -configure -allowAccessFor -allUsers -privs -all >/dev/null
sudo "$KICK" -configure -clientopts -setvnclegacy -vnclegacy yes -setvncpw -vncpw "$VNC_PW" >/dev/null
sudo launchctl enable system/com.apple.screensharing
sudo launchctl bootstrap system /System/Library/LaunchDaemons/com.apple.screensharing.plist 2>/dev/null || true
sleep 2
nc -z 127.0.0.1 22 && echo "22 open"
nc -z 127.0.0.1 5900 && echo "5900 open" || echo "5900 がまだ開いていない（再起動後に確認）"

step "sshd の Access CA"
sudo install -m 0644 -o root -g wheel "$HOME/ca.pub" /etc/ssh/ca.pub
sudo install -m 0644 -o root -g wheel "$HOME/50-cloudflare-access.conf" /etc/ssh/sshd_config.d/50-cloudflare-access.conf
grep -q '^Include /etc/ssh/sshd_config.d/\*' /etc/ssh/sshd_config && echo "Include あり"
sudo sshd -t && echo "sshd -t OK"

step "newsyslog"
sudo install -m 0644 -o root -g wheel "$HOME/macmini.conf" /etc/newsyslog.d/macmini.conf

step "作業ファイルを消す"
rm -f "$SECRETS" "$HOME/ca.pub" "$HOME/50-cloudflare-access.conf" "$HOME/macmini.conf"
echo "stage1 done"
