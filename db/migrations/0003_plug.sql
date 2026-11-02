-- 0003_plug: スマートプラグ（SwitchBot プラグミニ）の直近の状態。Cron が 1 分ごとに取って 1 行を上書きする（docs/spec.md 6.1）。
-- トークンや機器 ID は入れない（Worker の secret / vars にだけ置く）。
CREATE TABLE IF NOT EXISTS plug_status (
  key TEXT PRIMARY KEY,            -- 'host'（プラグは 1 つ）
  checked_at INTEGER NOT NULL,     -- unix ミリ秒（取得した時刻）
  ok INTEGER NOT NULL,             -- 1: クラウドに届いて応答が読めた / 0: 届かない・エラー
  state TEXT NOT NULL,             -- 'on' | 'off' | 'unknown'
  watts REAL,                      -- 現在の消費電力（W）。取れなければ NULL
  error TEXT                       -- 取れなかった理由の短い要約（秘密を含めない）
);
