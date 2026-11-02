#!/bin/bash
# 上流（OSS の main）の更新を、自分の導入（deploy ブランチ）に取り込む。
#
#   bash kit/update.sh            # upstream/main から deploy を作り直す（コミットまで。デプロイはしない）
#
# 仕組み：deploy ブランチは「upstream/main ＋ kit/site.json を当てたコミット 1 つ」。毎回作り直すので、
# 上流の変更と自分の値がぶつかってマージで困ることがない。自分でコードを直したいときは上流に PR を送る。
#
# 前提：
#   - remote「upstream」が OSS のリポジトリを指している（git remote add upstream https://github.com/BridgeUI/macmini-dashboard.git）
#   - いまのブランチが deploy で、kit/site.json がコミットされている（git add -f kit/site.json）
#   - 作業ツリーがきれい
set -euo pipefail
cd "$(dirname "$0")/.."

branch="$(git rev-parse --abbrev-ref HEAD)"
[ "$branch" = "deploy" ] || { echo "deploy ブランチで実行する（いま: $branch）" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "コミットしていない変更がある。先に片付ける" >&2; git status --short >&2; exit 1; }
git remote get-url upstream >/dev/null 2>&1 || { echo "remote upstream が無い（上のコメント参照）" >&2; exit 1; }

git cat-file -e HEAD:kit/site.json 2>/dev/null || { echo "deploy に kit/site.json がコミットされていない" >&2; exit 1; }

# 導入先だけのファイル（site.json・SSH CA 公開鍵・差し替えたロゴと画面写真）を退避して、作り直したあとに戻す。
# 対象は「前回の upstream から deploy で足した・変えたもの」のうち、下の場所にあるものだけ（guide は画像だけ）。
KEEP=(kit/site.json cloudflare/access/ca worker/public/logo.png worker/public/guide)
keep="$(mktemp -d)"
trap 'rm -rf "$keep"' EXIT
base="$(git merge-base HEAD upstream/main 2>/dev/null || git rev-list --max-parents=0 HEAD | tail -1)"
{ git diff --name-only --diff-filter=AM "$base" HEAD -- "${KEEP[@]}" | grep -vE '^worker/public/guide/.*\.(html|css|js)$'; echo kit/site.json; } | sort -u | while read -r f; do
  mkdir -p "$keep/$(dirname "$f")" && git show "HEAD:$f" >"$keep/$f"
done

prev="$(git rev-parse --short HEAD)"
git fetch upstream main
up="$(git rev-parse --short upstream/main)"
git checkout -q -B deploy upstream/main
cp -R "$keep/." .
echo "導入先のファイルを戻した:"; (cd "$keep" && find . -type f | sed 's#^\./#  #')

npm ci
node kit/personalize.mjs kit/site.json
npm run build:ui --workspace worker
npm run typecheck
npm test --workspaces --if-present

git add -A
git add -f kit/site.json
git commit -q -m "導入先の値を適用（upstream ${up}）"
echo
echo "deploy を upstream ${up} から作り直した（前は ${prev}。戻すなら git reset --hard ${prev}）。"
echo "次にやること:"
echo "  cd worker && npx wrangler d1 migrations apply macmini-dashboard --remote && npx wrangler deploy"
echo "  git push --force-with-lease origin deploy        # 自分の private リポジトリへ"
echo "  各マシンで: git fetch origin && git reset --hard origin/deploy && npm ci && npm run build --workspace agent"
echo "             → launchctl kickstart -k gui/\$(id -u)/<label_prefix>.agent（kit/lessons.md の注意を先に読む）"
