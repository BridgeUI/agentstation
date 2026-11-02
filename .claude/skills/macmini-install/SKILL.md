---
name: macmini-install
description: このリポジトリ（Mac mini 3 環境の監視ダッシュボード）を、新しい導入者の Mac mini・Cloudflare アカウント・ドメインで立ち上げる、または導入済みの deploy ブランチに上流の更新を取り込む。「導入して」「セットアップして」「更新を取り込んで」と言われたとき、または /macmini-install で使う。
---

`kit/START.md` を読み、その手順に上から従って導入者と対話しながら進める。

- どこまで進んでいるかを先に確かめる：`git branch --show-current`（`deploy` があるか）、`kit/site.json` の有無、`kit/source.json` の `domain` が `site.json` と同じか（同じなら値の置き換えは済み）、`grep REPLACE_WITH worker/wrangler.toml`。
- 新しく導入するなら 1 章（前提の確認と聞き取り）から。導入済みで更新を取り込むなら 9 章。
- 各段階の「確認」が済むまで次に進まない。
- 秘密情報は導入者にチャットへ貼らせない（`CLAUDE.md` 守ること 3、`kit/START.md` 0 章）。
- `main` に導入先の値をコミットしない（`deploy` ブランチにだけ）。
