# agentstation

Mac mini 1台（メモリ24GB・SSD 512GB）で3つの環境（host＋macOS VM 2台）を常駐させ、各環境で Claude Code / Codex を動かし続ける。その状態を Cloudflare 上のダッシュボードから確認・操作する仕組みのリポジトリ（OSS。MIT ライセンス）。

- `main` には見本の値（example.com、利用者 Taro / Hanako / Jiro）が入っている。実際の導入先の値は `kit/site.json` を `kit/personalize.mjs` で当てた `deploy` ブランチ（導入者の private リポジトリ）に持つ。**`main` に実在のメールアドレス・ドメイン・Cloudflare の ID を入れない。**
- 新しく導入する人を手伝うとき：`kit/START.md` に従う（`/agentstation-install`）。

- 仕様の全体：`docs/spec.md`
- 実装の順番と完了条件：`docs/tasks.md`
- 実機で確定した初期構築の手順：`docs/initial-setup.md`（設計時の詳細は `docs/setup-mac.md`、前提の確認表は `docs/verify.md`）
- 利用者（Hanako / Jiro）向けの使い始め方：`docs/onboarding.md`（画面版はダッシュボードの「接続ガイド」）
- 壊れたときの直し方：`docs/runbook.md`
- 導入キット（値の置き換え・導入手順・上流の更新の取り込み）：`kit/README.md`（Claude 向けの手順は `kit/START.md`）
- 設計判断の記録（FileVault オフ、Workers 統合、各環境にエージェント、Slack 通知、スマートプラグ連携など）：`docs/spec.md` 13章
- 画面デザイン（参照用モック）：`design/`

## 環境と利用者

| 環境 | 実体             | 使う人           | Claudeアカウント |
| ---- | ---------------- | ---------------- | ---------------- |
| host | Mac mini本体     | Taro（オーナー） | A                |
| vm1  | Tart の macOS VM | Hanako           | B                |
| vm2  | Tart の macOS VM | Jiro             | C                |

VM は 0〜2 台から選べる（macOS の使用許諾で 1 台の Mac につき 2 つまで）。使う VM は `MEMBERS_JSON.envs` に書いたものだけ。3 台以上（2 台目の Mac など）は今後の検討（`docs/spec.md` 13章 #24）。

UIでは「Taro の環境」のように人を主役に見せ、host/vm1/vm2 は補足扱い。ただしホスト名やIDはマシン名（host/vm1/vm2）で固定する（使う人が替わってもURLを変えないため）。

## 守ること（設計上の前提）

1. **Macからは外向き接続だけ**。自宅ルーターのポートは開けない。ダッシュボード→Macの操作は「D1に指示を積む → エージェントが次のハートビートで拾う」方式。
2. **エージェントはLLMではない**。決め打ちの操作（ホワイトリスト）だけを実行する。任意のシェルコマンドを受け付ける経路を作らない。
3. **秘密情報を画面・D1・ログに出さない**。パスワード、SSH鍵、APIキー、トークン、会話内容、ファイル名はダッシュボードに送らない。例外は 3 つ：セッションのタイトル（復元画面用。本人とオーナーにだけ返し、60文字で切り、履歴・通知・監査ログには残さない）、作業フォルダ直下のフォルダ名（Remote Control の起動先を選ぶため。パスは送らない）、VNC パスワード（オーナーの決定。ダッシュボード自体が Zero Trust の内側なので、押したときだけ本人・オーナーに 60 秒表示する。Worker の secret に置き、D1・ハートビート・ログには残さない。見たことだけ監査ログに残す）。`docs/spec.md` 9章・13章。
4. **権限はサーバー側で判定**。Worker で Cloudflare Access の JWT（`Cf-Access-Jwt-Assertion`）を検証し、メールアドレスからロールを決める。画面でボタンを隠すだけにしない。
5. **SSH鍵は登録しない**。SSHは Cloudflare Access の短期証明書（ブラウザ経由 or WARP経由）。
6. **未確認事項は推測で埋めない**。`docs/spec.md` の「未確認事項」は、実機で確かめてから実装を確定する。確かめられないものはコードにTODOと理由を残し、利用者に報告する。

## 技術構成（推奨）

- ダッシュボード：Cloudflare Workers 1つ（静的アセット＋API＋Cron Trigger 1分ごと）＋ D1。TypeScript。UIフレームワークは必須ではない（素のTS＋軽量テンプレートで可）。通知は Example の Slack（Incoming Webhook）。
- エージェント：Node.js（TypeScript）。同じプログラムを host・vm1・vm2 の3か所に置き、`--env` で役割を切り替える。launchd で常駐。
- Mac側の常駐：launchd。cloudflared だけ LaunchDaemon、それ以外は LaunchAgent。VMは Tart（`tart run --no-graphics`）。VM の IP は固定する。
- 接続：cloudflared（Tunnel）、Cloudflare Access（ログインは Google。ブラウザ表示のSSH/VNC）、WARP＋Access for Infrastructure。
- ドメイン：`workstation.example.com`（ダッシュボード）、`ssh-{host,vm1,vm2}.example.com`、`vnc-{host,vm1,vm2}.example.com`。サブドメインは1階層だけ。

## リポジトリ構成

```
worker/           Workers（public/ に画面、src/api/ にAPI、src/cron/ に途絶検知・期限切れ指示・Slack通知）
db/               D1 スキーマとマイグレーション
agent/            各環境に常駐する監視プログラム（Node.js/TS。host/vm1/vm2 共通）
mac/              launchd の plist テンプレート、夜間メンテ用スクリプト、sudoers 断片
cloudflare/       cloudflared 設定テンプレート、Access 設定の手順書、wrangler 設定
docs/             spec.md, tasks.md, 運用手順
kit/              導入キット（personalize.mjs、update.sh、START.md）
design/           画面モック（参照用。そのまま本番には使わない）
```

## 作業の進め方

- 設計の変更は `docs/spec.md`（13章に判断の記録）と `docs/tasks.md` に反映する。
- 変更したら `npm run typecheck`、`npm test --workspaces --if-present`、`npm run lint`。画面（`worker/ui/`）を直したら `npm run build:ui --workspace worker` で `worker/public/app.js` を作り直してコミットする。
- 新しく固有の値（ドメイン・名前など）をコードに書くときは、`kit/personalize.mjs` で置き換えられる形（`kit/source.json` の値そのまま）にする。
- 実機（Mac mini）が必要な確認は、手順と期待結果を書いて利用者に依頼する。
- 秘密情報は `wrangler secret` とmacOSのキーチェーン（またはchmod 600のファイル）で扱い、リポジトリにコミットしない。`.env*` と鍵類は `.gitignore`。
- UI文言は日本語。トンマナは App Store Connect 風（ページ #F5F5F7 に白カード、ヘアラインの枠、角丸12px、システムフォント、影なし。2026-11-01 改定）。詳細は `design/README.md`、基準の CSS は `design/redesign/style.css`。
- 説明的な文章は各セクションの「説明」ボタンで開閉し、常に見せるのは見出し・数値・状態・ボタン・警告だけ。
