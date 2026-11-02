# 元の導入で分かったはまりどころ

元の構成を作ったとき（2026-10〜11）に実際に起きたこと。手順上の注意は `docs/initial-setup.md` 5.8 にもある。

## エージェントを再起動すると、そのマシンの作業中の Claude セッションも切れる

フォルダごとの Remote Control はエージェントの子プロセス（`docs/spec.md` 13章 #13）。host で `launchctl kickstart -k gui/$(id -u)/<label_prefix>.agent` を打つと一緒に止まる（メインの claude-rc は別の LaunchAgent なので無事）。

→ 導入作業を host の Remote Control 越しの Claude Code でしているなら、エージェントの再起動は **応答の最後** に置き、先に確認手順（`launchctl print …` とダッシュボードの最終報告時刻）を書いておく。

## Claude のフォルダの信頼は git リポジトリの境界で切れる

`claude remote-control` は、cwd 自身が `~/.claude.json` で信頼済みか、信頼済みの祖先が cwd の git ルート以下にあるときだけ起動する。空フォルダは親（`~/workspace`）の信頼を引き継ぐが、中で `git clone` / `git init` した瞬間に別の境界になり、次の起動で「Workspace not trusted」で終わる（stdout にだけ出て `--debug-file` には残らない）。

→ ダッシュボードからの起動は「起動＝そのフォルダを信頼する」として信頼を記録する（実装済み）。手で起動して失敗したら `cd <dir> && claude remote-control --name x </dev/null` で再現できる。

## ホーム直下を作業フォルダにしない

ホーム直下では信頼が保存されない。作業フォルダは `~/workspace`。

## サービストークンの JWT の common_name は Client ID

トークンの「名前」ではない。`AGENT_TOKEN_NAMES` には各トークンの Client ID を入れる。

## Google の同意画面を「内部」にすると Gmail の人が入れない

Workspace の組織内だけになる。メンバーに Gmail の人がいるなら「外部」＋本番公開。入れる人の制限は Access のポリシー（メール一覧）で行う。

## WARP の「証明書がない」警告

Zero Trust の Gateway 証明書が有効でないと出る。TLS 復号をオフにしていれば SSH / VNC には影響しない。証明書の新規生成は 24 時間に 3 枚まで。

## iPhone の横向き・折りたたみ端末

Safari では端末側の縦の列の下まで Web は広がらない（WebKit 公式の記述）。表示の崩れを決め打ちの値で寄せない。端末固有の挙動は Apple / WebKit の公式情報を先に確認する。

## 文言

「フォルダを信頼する」「信頼済みにする」と書く（「信頼を付ける」とは書かない）。UI の文言は日本語、説明は「説明」ボタンの中に入れる（`CLAUDE.md`）。
