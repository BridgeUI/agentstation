# agentstation

**自分の Mac で Claude Code を動かし続け、スマホから見守り・操作する。**

[English](README.md) | 日本語

<p align="center"><img src="docs/media/overview.ja.gif" width="960" alt="動作の流れ：各環境のエージェントが Cloudflare に報告し、スマホで状態を見て、切断を検知して Slack に通知し、ボタンで復旧する。フォルダごとの Remote Control もスマホから起動できる"></p>
<p align="center"><sub>MP4 版：<a href="docs/media/overview.ja.mp4"><code>docs/media/overview.ja.mp4</code></a></sub></p>

agentstation は、Mac に常駐させた Claude Code の Remote Control を、Cloudflare 上のダッシュボードからまとめて管理するツールです。Mac 本体に加えて macOS の VM を最大 2 台まで動かせるので、1 台の Mac を最大 3 人で分け合い、それぞれがスマホの Claude アプリから自分の環境を使えます。VM を使わず、1 人で Mac 本体だけを使うこともできます。

## 特徴

- **スマホから Remote Control を起動**：フォルダを選んで起動すると、そのまま Claude アプリで続きができます。ターミナルは要りません。
- **全環境の状態をひと目で確認**：Claude Code・Remote Control・Codex・VM が動いているかと、CPU・メモリ・ディスクの使用量を一覧で見られます。
- **ボタン 1 つで復旧**：Remote Control の立て直し、Claude Code の更新、VM やホストの再起動、スマートプラグでの電源の入れ直しができます。
- **異常を Slack に通知**：報告が途絶えたときや、再ログインが必要になったときに知らせます（任意）。
- **ブラウザで SSH・画面共有**：Cloudflare Access 経由で入れます。WARP を使えば iPhone のアプリからも接続できます。
- **ポートを開けない**：Mac からは外向きの接続しかしません。エージェントは決め打ちの操作だけを実行し、任意のコマンドは受け付けません。

![ダッシュボードの一覧](worker/public/guide/dashboard-overview.jpg)

## クイックスタート

### 必要なもの

- Claude 専用にできる Apple Silicon の Mac（Mac mini、Mac Studio など。VM を 2 台使うならメモリ 24GB 以上を推奨）
- Cloudflare アカウントと、DNS を Cloudflare に置いた独自ドメイン（無料プランで足ります）
- 使う人のメールアドレスと Claude のアカウント
- 任意：Slack の Incoming Webhook、SwitchBot プラグミニ

### 導入

Claude Code と一緒に進めます。

```bash
mkdir -p ~/workspace && cd ~/workspace
git clone https://github.com/BridgeUI/agentstation.git
cd agentstation
claude
```

Claude Code に次のように頼みます（`/agentstation-install` でも同じです）。

```
kit/START.md を読んで、このリポジトリを私の環境に導入するのを手伝ってください。
```

Cloudflare の設定はスクリプトがまとめて作り、進み具合は `kit/doctor.mjs` が確かめて次の手順を示します。あなたがやるのは、ブラウザでのログイン、sudo のパスワード入力、秘密情報の入力、実機での確認です。所要時間は半日〜1 日が目安です。

## 仕組み

```
スマホ・PC ──(Cloudflare Access でログイン)──> Worker ＋ D1（ダッシュボード）
                                                   ↑ 60 秒ごとに状態を報告し、指示を受け取る
Mac
 ├─ host：エージェント、Claude Code の Remote Control、cloudflared
 ├─ vm1（任意）：エージェント、Claude Code の Remote Control
 └─ vm2（任意）：エージェント、Claude Code の Remote Control
```

ダッシュボードで押した操作はいったん D1 に積まれ、各環境のエージェントが次の報告のときに受け取って実行します。パスワード・トークン・会話の内容はダッシュボードに送りません。詳しくは [`docs/spec.md`](docs/spec.md) を見てください。

## 制約

- VM は 0〜2 台までです（macOS の使用許諾で、1 台の Mac で動かせる macOS の VM は 2 つまで）。
- 画面と導入手順は日本語のみです。
- 動作を確認したのは macOS 27、Claude Code 2.1 系、Tart 2.41 です。状態の判定は Claude Code のログの形式に依存しているため、バージョンによってはずれることがあります。

## ドキュメント

| 内容                           | 場所                                             |
| ------------------------------ | ------------------------------------------------ |
| 導入の手順（Claude Code 向け） | [`kit/START.md`](kit/START.md)                   |
| 導入キットと設定ファイル       | [`kit/README.md`](kit/README.md)                 |
| 構築の詳しい手順               | [`docs/initial-setup.md`](docs/initial-setup.md) |
| 利用者向けの使い始め方         | [`docs/onboarding.md`](docs/onboarding.md)       |
| 壊れたときの直し方             | [`docs/runbook.md`](docs/runbook.md)             |
| 仕様と設計判断                 | [`docs/spec.md`](docs/spec.md)                   |

## 開発

```bash
npm ci
npm run typecheck && npm test --workspaces --if-present && npm run lint
npm run dev    # ローカルで起動（見本データは docs/dev.md）
```

開発のルールは [`CLAUDE.md`](CLAUDE.md) にあります。リポジトリには見本の値だけを入れ、実在のメールアドレス・ドメイン・Cloudflare の ID はコミットしないでください。

## ライセンス

[MIT](LICENSE)
