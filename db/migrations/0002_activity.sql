-- 0002_activity: 画面が最後に見られた時刻。エージェントの報告間隔を速めるかの判断に使う（docs/spec.md 3.6）。
CREATE TABLE IF NOT EXISTS activity (
  key TEXT PRIMARY KEY,            -- 'view'（画面の /api/status が呼ばれた）
  at INTEGER NOT NULL              -- unix ミリ秒
);
