# 画面デザイン（参照用モック）

Claude の Design キャンバスで作った画面モック。最新版：

| ファイル        | 画面                                                                                                                                                              |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Main.dc.html`  | 一覧（全体ステータス、Mac mini全体の使用量・配分、各環境カード、操作履歴、イベント）                                                                              |
| `Host.dc.html`  | Taro の環境（host）                                                                                                                                               |
| `Vm1.dc.html`   | Hanako の環境（vm1）                                                                                                                                             |
| `Vm2.dc.html`   | Jiro の環境（vm2）                                                                                                                                                |
| `Guide.dc.html` | 接続ガイド（A：ブラウザ／B：WARP＋アプリ、図解付き）                                                                                                              |
| `logo.png`      | Example のロゴ（example.com のナビゲーションと同じもの）                                                                                                        |
| `redesign/`     | 2026-11-01 の構造改善案（App Store Connect 風。表・タブ・KPIタイルで縦スクロールを半分以下に）。提案書は `redesign/README.md`、モックは素の HTML でそのまま開ける |

## 注意

- `.dc.html` は Design キャンバス専用の形式（`<x-dc>`、`{{hole}}`、`<sc-if>`、`<sc-for>`、`class Component extends DCLogic`）。**そのままでは動かない**。見た目・構成・文言・状態の出し分けの参照にして、本番は通常のHTML/CSS/TSで作り直す。
- `renderVals()` の中の数値・時刻・履歴はすべてサンプル。本番は `/api/status` の値を使う。
- `data-props` の `scenario`（正常／vm2のClaude停止／vm1の再ログインが必要／応答なし）と `role`（本人／閲覧者）は、状態ごとの見え方を確認するための切り替え。
- ロゴは `/_blob/...` を参照しているので、本番では `logo.png` に差し替える。

## トンマナ（2026-11-01 改定。App Store Connect 風。基準は `redesign/style.css`）

example.com のサイトと同じ白黒基調は保ちつつ、ダッシュボードは「薄いグレーの地に白いカード」の Apple 風にする。黒い枠線と角丸 4px はやめた（経緯は `redesign/README.md` 2章）。

| 項目                     | 値                                                                                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 書体                     | システムフォント（-apple-system, BlinkMacSystemFont, "Helvetica Neue", "Hiragino Sans", "Hiragino Kaku Gothic ProN"）。`font-feature-settings: 'palt'`。コードは SFMono-Regular, Menlo, Consolas |
| 文字サイズ               | 本文 15px、表 15px、補足 12〜13px、h1 26px/600、パネル見出し 17px/600、KPI の数字 28px/500                                                                                                       |
| 文字色                   | 本文 #000000、補足 #6E6E73                                                                                                                                                                       |
| 背景                     | ページ #F5F5F7、カード・ナビ #FFFFFF                                                                                                                                                             |
| 線                       | カードの枠 0.5px rgba(0,0,0,.10)、区切り rgba(0,0,0,.10) / rgba(0,0,0,.06)。黒ベタの線は使わない                                                                                                 |
| 角丸                     | カード・バナー 12px、ボタン・セグメント 8px、タグ 4px、状態ピル・アバターは丸                                                                                                                    |
| ボタン                   | 塗り rgba(0,0,0,.06)・枠なし・13px/500。主ボタンは黒塗り白文字。危険は赤 8% の塗りに赤文字                                                                                                       |
| セグメント               | グレー地 rgba(0,0,0,.06) に白いつまみ（iOS 風）                                                                                                                                                  |
| 影・グラデーション       | 使わない                                                                                                                                                                                         |
| 状態色（丸のみ）         | 正常 #2E9B4F、注意 #E8890C、異常 #D93025、不明 #AAAAAA                                                                                                                                           |
| 状態色（文字）           | 注意 #8A4B00、異常・危険操作 #C4291C                                                                                                                                                             |
| 人の区別（積み上げバー） | Taro #000000、Hanako #5C5C5C、Jiro #AAAAAA、空き rgba(0,0,0,.06)                                                                                                                                |
| 表の行                   | 44px（タップ領域を兼ねる）。見出しは 12px の補足色。数値は右揃え・等幅数字                                                                                                                       |
| タップ領域               | 44px 以上                                                                                                                                                                                        |

本番 UI（`worker/public/`）は 2026-11-01 に改定後へ作り直した。旧トンマナ（Zen Kaku Gothic New、白地、0.5px #000 の枠、角丸 4px）は `*.dc.html` のモックにだけ残っている。

## 画面の決まりごと

- 人を主役に見せる（「Hanako の環境」）。host/vm1/vm2 は補足
- 説明文は各セクション見出し横の「説明」ボタンで開閉。常に見せるのは見出し・数値・状態・ボタン・警告
- パスワード・SSH鍵・APIキーは表示しない
- スマホ幅でも崩れない（カードは折り返し、表は横スクロール。環境の表はスマホでプロセス列を隠す）
- 長い画面はタブ（URL ハッシュで深いリンク）。完了済みの項目は折り畳む。注意は 1 行＋飛び先リンク

## スマホ・二画面・PWA（2026-11-01）

- **スマホ幅（640px 以下）**：グローバルナビは画面下の固定タブバー（一覧／Taro／Hanako／Jiro／接続ガイド）。タイルは 2 列。表は横スクロール。入力欄は 16px（iOS の拡大を防ぐ）。`viewport-fit=cover` でノッチ・ホームバーの safe-area を避ける
- **タッチ端末（pointer: coarse）**：ボタン・リンク・タブは 44px 以上
- **二画面・折りたたみ（Surface Duo、Galaxy Fold）**：`horizontal-viewport-segments: 2` のとき main を左右 2 列にし、列間を `env(viewport-segment-*)` でヒンジ幅に合わせる。見出し・バナー・タブは両面にまたがり、パネルは 1 面に 1 つずつ流す。縦 2 面（横持ち）ではタブの sticky を外す。実機では未確認（CSS はメディアクエリで囲っているので他の端末には影響しない）
- **iPhone Duo の横向き（2026-11-01 調査）**：横向きでは右端に縦の列（Safari の操作と、時計・電池などシステムの表示）が出て、Web ページの表示域はその左までになる。WebKit 公式（Safari 27.1 の機能紹介、2026-10-23）は「Safari 27.1 では、Web コンテンツはこの操作の背後の領域まで広がらない。背景色だけがそこに延びる」「viewport-fit=cover で広げる案も検討したが、4 辺を正しく避けられていないサイトが多く、より良い方法を調査中」としている。つまり現時点でページ側からその列を使う公式の手段は無い。できるのは背景色（body の背景・theme-color）をページに合わせることだけで、今の薄い灰色のままにする。安全領域の余白は左右を別々に `max(var(--gutter), env(safe-area-inset-left / -right))` で取っている（Apple の「安全領域は左右非対称。片側の値を両側に使わない」に沿う）。Device Posture API と Viewport Segments API は Safari 27.1 ではフィーチャーフラグ付きの開発者プレビュー。出典：https://webkit.org/blog/18486/webkit-features-for-safari-27-1/ 、https://developer.apple.com/videos/play/tech-talks/111461/ 、https://developer.apple.com/videos/play/tech-talks/111466/
- **PWA**：`manifest.webmanifest`（standalone、アイコンは `public/icons/`、各環境へのショートカット）と `sw.js`。Service Worker は `/api/*` を一切キャッシュせず、画面と静的ファイルだけ「ネットワーク優先、落ちていたらキャッシュ」。オフライン時は `offline.html`。Cloudflare Access の裏にあるため、manifest の `<link>` には `crossorigin="use-credentials"` が必要（Cookie なしで取りに行くと Access のログイン画面が返る）。localhost では登録しない（開発中に古い app.js を掴まないため）
- アイコンはロゴ（黒・透過）を白地の正方形に置いたもの。maskable 用はロゴを 55% に縮めて安全領域に収める。作り直すときは `logo.png` から（Swift の CoreGraphics で生成した。手順は `design/redesign/README.md` 7章）
