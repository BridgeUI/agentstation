# 開発環境

## 必要なもの

- Node.js 22 以上。バージョン管理ツールで入れる（この環境は Homebrew の nodebrew で v24 を導入済み。`~/.zprofile` に `~/.nodebrew/current/bin` を追加してある）。VM の中にも同じ手順で入れる
- npm（Node に同梱）

## 初回

```bash
npm install
```

## 日常

| やること | コマンド |
| --- | --- |
| 型チェック（shared / worker / agent） | `npm run typecheck` |
| Worker のテスト（Workers ランタイム＋D1） | `npm test --workspace worker` |
| lint | `npm run lint` |
| 整形 | `npm run format` |
| D1 をローカルに作る | `npm run db:migrate:local` |
| Worker をローカルで動かす | `npm run dev`（`--host localhost` 付き。カスタムドメインの設定があるため、これが無いと LOCAL_DEV_EMAIL のログイン代替が効かない）→ http://localhost:8787/ と http://localhost:8787/api/health |
| 画面（TS→app.js）をビルド | `npm run build:ui --workspace worker`（public/app.js はコミット対象） |
| エージェントをビルド | `npm run build --workspace agent` → `agent/dist/index.js` 1ファイル |
| 使い方ガイドの写真を撮り直す | `worker/scripts/guide-shots.mjs` の冒頭の手順（見本データの wrangler dev を headless Chrome で撮る。playwright-core は作業用フォルダに入れる） |

## 構成

```
shared/   worker と agent で共有する型・ホワイトリスト・MEMBERS_JSON の検証
worker/   静的UI（public/）＋ API（src/api/）＋ Cron（src/cron/）。wrangler.toml はここ
db/       D1 のマイグレーション（worker/wrangler.toml から参照）
agent/    各環境に置く常駐プログラム。esbuild で 1 ファイルにして launchd から起動する
mac/      launchd・sudoers・newsyslog・sshd のテンプレート
cloudflare/ cloudflared と Access・WARP の設定手順
```

## 注意

- `worker/wrangler.toml` の `compatibility_date` が手元の wrangler より新しいと怒られる。その場合は wrangler を更新するか、日付を下げる。
- 秘密情報（Slack Webhook、サービストークン）はリポジトリに書かない。Worker は `wrangler secret put`、エージェントは `~/.config/macmini-agent/token.json`（chmod 600）。
