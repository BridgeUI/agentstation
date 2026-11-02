#!/bin/bash
# VM ゲストの基礎設定・第 3 段：IP の固定（docs/setup-mac.md 4.3 (a)。ゲスト内で静的 IP）。
# 実行すると SSH が切れるので最後に。ゲストの中で admin（または利用者。sudo 可）として実行する。
#
#   ssh admin@<いまの IP> 'GUEST_IP=192.168.64.10 bash -s' < mac/scripts/vm-guest-stage3.sh
#
# vm1 → 192.168.64.10、vm2 → 192.168.64.11。ルーター・DNS は Tart の NAT の 192.168.64.1。
set -euo pipefail
: "${GUEST_IP:?GUEST_IP（192.168.64.10 / .11）が必要}"
SERVICE="${GUEST_NET_SERVICE:-Ethernet}"
networksetup -listallnetworkservices | grep -qx "$SERVICE" || { echo "ネットワークサービス $SERVICE が無い" >&2; networksetup -listallnetworkservices >&2; exit 1; }
echo "$SERVICE を $GUEST_IP に固定する（この接続は切れる）"
sudo networksetup -setdnsservers "$SERVICE" 192.168.64.1
sudo networksetup -setmanual "$SERVICE" "$GUEST_IP" 255.255.255.0 192.168.64.1
