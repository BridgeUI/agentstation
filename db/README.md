# D1 スキーマ

- `migrations/`：wrangler の D1 マイグレーション（番号順に適用）。`worker/wrangler.toml` の `migrations_dir` がここを指す。
- `schema.sql`：現時点の全体像（参照用）。マイグレーションを足したら同じ内容を反映する。

ローカルで作る：

```bash
npm run db:migrate:local
```

本番に適用する（Taro が実行）：

```bash
npm run db:migrate:remote --workspace worker
```

ルール：時刻は unix ミリ秒（UTC）。秘密情報・会話内容・パスは入れない（例外はセッションのタイトル 60 文字まで。`docs/spec.md` 9章）。
