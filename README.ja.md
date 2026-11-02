# macmini-dashboard

[English](README.md) | **日本語**

Mac mini 1 台で macOS 環境（本体と、Tart の VM 0〜2 台）を常駐させ、それぞれで Claude Code の Remote Control（と Codex）を動かし続ける。その状態を Cloudflare 上のダッシュボードから確認・操作する仕組み一式。

1 台の Mac mini を最大 3 人で分け合い、各自がスマホの Claude アプリから自分の環境の Claude Code を使う、という使い方を想定している。1 人で本体だけを使ってもよい。

<p align="center"><img src="docs/media/overview.ja.gif" width="960" alt="動作の流れ：各環境のエージェントが Cloudflare に報告し、スマホで状態を見て、切断を検知して Slack に通知し、ボタンで復旧する"></p>
<p align="center"><sub>MP4 版：<a href="docs/media/overview.ja.mp4"><code>docs/media/overview.ja.mp4</code></a></sub></p>

## できること

- 環境の状態を一覧：Claude Code・Remote Control・Codex・VM・エージェントの生死、CPU / メモリ / ディスク
- ボタンで復旧：Remote Control の立て直し、Claude Code の更新、VM の再起動、ホストの再起動（猶予つき）、スマートプラグでの電源の入れ直し（SwitchBot、任意）
- 作業フォルダごとの Remote Control の作成・起動・停止、セッションの復元
- 途絶・要ログインなどを Slack に通知（任意）
- ブラウザだけで SSH / 画面共有（Cloudflare Access）。WARP 経由で iPhone の SSH・VNC・ファイルアプリからも
- 利用者向けの使い方ガイド（ダッシュボード内）

![ダッシュボードの一覧](worker/public/guide/dashboard-overview.jpg)

## 仕組み

```
スマホ・PC ──(Cloudflare Access：Google ログイン)──> Worker ＋ D1（画面・API・1 分ごとの Cron）
                                                          ↑ 60 秒ごとのハートビートで状態を送り、指示を受け取る
Mac mini
 ├─ host：エージェント、claude remote-control、cloudflared（Tunnel。SSH / VNC を外向き接続で公開）
 ├─ vm1（Tart。任意）：エージェント、claude remote-control
 └─ vm2（Tart。任意）：エージェント、claude remote-control
```

- Mac 側からは外向きの接続だけ。ダッシュボードからの操作は D1 に積まれ、エージェントが次のハートビートで拾う
- エージェントは LLM ではなく、決め打ちの操作（ホワイトリスト）だけを実行する。任意のコマンドを送る経路は無い
- パスワード・トークン・会話内容・ファイル名はダッシュボードに送らない
- 権限は Worker が Access の JWT で判定する（オーナー／本人／閲覧者）

詳しくは [`docs/spec.md`](docs/spec.md)。

## 必要なもの

- Apple Silicon の Mac。**Claude 専用にできるもの**（FileVault オフ・自動ログイン・スリープ無効にする）。VM を 2 台使うならメモリ 24GB 以上を推奨
- Cloudflare アカウントと、DNS を Cloudflare に置いた独自ドメイン（Workers・D1・Zero Trust とも無料プランで可）
- 使う人の Google アカウント（Gmail で可）と Claude のアカウント
- 任意：Slack の Incoming Webhook、SwitchBot プラグミニ

## 導入

Claude Code に手伝ってもらう前提で手順を書いてある。人がやるのは、ブラウザでのログインと画面操作、sudo のパスワード入力、秘密情報の入力、実機での確認。目安は半日〜1 日。

```bash
mkdir -p ~/workspace && cd ~/workspace
git clone https://github.com/BridgeUI/macmini-dashboard.git
cd macmini-dashboard
claude
```

Claude Code に次のように頼む（`/macmini-install` でも同じ）：

```
kit/START.md を読んで、このリポジトリを私の環境に導入するのを手伝ってください。
```

導入キットの中身と、上流の更新の取り込み方は [`kit/README.md`](kit/README.md)。手順の本体は [`docs/initial-setup.md`](docs/initial-setup.md)。

## 制約

- 環境の名前は host・vm1・vm2 で固定。VM は 0〜2 台（macOS の使用許諾で、1 台の Mac で動かせる macOS の VM は 2 つまで）。VM は Tart、IP は `192.168.64.10` / `.11`
- 画面と導入手順は日本語
- 実機で確かめたのは macOS 27、Claude Code 2.1 系、Tart 2.41。Claude Code の Remote Control のログの形などに依存しているので、バージョンが変わると状態の判定がずれることがある（`agent/src/collect/`）

## 開発

```bash
npm ci
npm run typecheck && npm test --workspaces --if-present && npm run lint
npm run dev    # wrangler dev。ローカルの見本データは docs/dev.md
node docs/media/overview.mjs   # アニメーション（SVG）を作り直す。MP4 / GIF は docs/media/render-video.mjs
```

開発のルールは [`CLAUDE.md`](CLAUDE.md)。`main` には見本の値だけを入れ、実在のメールアドレス・ドメイン・Cloudflare の ID はコミットしない。

## ライセンス

[MIT](LICENSE)
