#!/bin/zsh
# ローカル確認用：nodebrew の node を PATH に通して wrangler dev を起動する
export PATH="$HOME/.nodebrew/current/bin:$PATH"
cd "$(dirname "$0")/../worker" && exec npm run dev
