---
name: agentstation-install
description: このリポジトリ（自分の Mac で Claude Code を動かし続け、Cloudflare のダッシュボードから見守り・操作する仕組み）を、新しい導入者の Mac・Cloudflare アカウント・ドメインで立ち上げる、または導入済みの環境に上流の更新を取り込む。「導入して」「セットアップして」「更新を取り込んで」と言われたとき、または /agentstation-install で使う。
---

`kit/START.md` を読み、その手順に上から従って導入者と対話しながら進める。

- どこまで進んでいるかを先に確かめる：`kit/site.json` の有無と `node kit/render-config.mjs --check` の結果（空の値が残っているか）、`https://<dashboard_host>/api/health`。
- 新しく導入するなら 1 章（前提の確認と聞き取り）から。導入済みで更新を取り込むなら 9 章。
- 各段階の「確認」が済むまで次に進まない。
- 秘密情報は導入者にチャットへ貼らせない（`CLAUDE.md` 守ること 3、`kit/START.md` 0 章）。
- リポジトリのファイルを導入先の値で書き換えない（値は `kit/site.json` だけ）。
