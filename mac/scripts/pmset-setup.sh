#!/bin/bash
# 電源・スリープの設定を一括で入れる（docs/spec.md 3.2 の表）。host と各 VM ゲストで実行する。
# 引数なし。副作用は pmset の変更だけ。sudo が必要（パスワードを聞かれる）。
#
#   sleep 0        システムのスリープを無効
#   disksleep 0    ディスクのスリープを無効
#   displaysleep 10 ディスプレイは 10 分で消してよい（ヘッドレスなので影響なし）
#   autorestartatconnect 1  電源が入ったら常に起動（システム設定の「自動的に起動：常に」。スマートプラグでの復帰に必須。
#                  「停電後」（autorestart）だと、意図してシャットダウンしたあとは電源を入れ直しても起動しない。docs/spec.md 3.2・6.1）
#   powernap 0     Power Nap オフ
#   womp 1         ネットワークアクセスによるスリープ解除（害はない）
#
# 期待する結果: 最後に表示される pmset -g に上の値が並ぶ。
# 要確認（docs/verify.md A-3）: 設定後 24 時間スリープしないこと。VM ゲストで autorestartatconnect / womp が
# 「not supported」と出る場合は無視してよい（ゲストはホストの電源に従う）。
set -u

if [ "$(uname)" != "Darwin" ]; then
  echo "macOS で実行する" >&2
  exit 1
fi

echo "== sudo pmset -a sleep 0 disksleep 0 displaysleep 10 autorestartatconnect 1 powernap 0 womp 1"
sudo pmset -a sleep 0 disksleep 0 displaysleep 10 autorestartatconnect 1 powernap 0 womp 1
status=$?
if [ $status -ne 0 ]; then
  echo "pmset が失敗した（終了コード $status）。VM ゲストでは一部のキーが無いことがある。1 つずつ試す:" >&2
  for kv in "sleep 0" "disksleep 0" "displaysleep 10" "autorestartatconnect 1" "powernap 0" "womp 1"; do
    # shellcheck disable=SC2086
    sudo pmset -a $kv && echo "  OK  $kv" || echo "  NG  $kv"
  done
fi

echo
echo "== pmset -g"
pmset -g
echo
echo "== pmset -g custom（AC/Battery ごとの値）"
pmset -g custom
echo
echo "次に mac/scripts/check.sh で値を確認する。システム設定 › エネルギー の「自動的に起動」が「常に」になっているか見る。"
