-- 0001_init: docs/spec.md 4.2 のたたき台。時刻はすべて unix ミリ秒（UTC）。

-- 環境ごとの最新状態（1行を上書き。host の行には VM の状態・使用量も入る）
CREATE TABLE IF NOT EXISTS heartbeats (
  env TEXT PRIMARY KEY,            -- 'host' | 'vm1' | 'vm2'
  received_at INTEGER NOT NULL,    -- サーバー受信時刻
  payload TEXT NOT NULL            -- エージェントが送った JSON（秘密情報を含めない。sessions は除く）
);

-- 7日分の履歴（5分に1回だけ保存。古いものは Cron が削除。sessions は含めない）
CREATE TABLE IF NOT EXISTS heartbeat_history (
  env TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (env, received_at)
);
CREATE INDEX IF NOT EXISTS idx_hh_received ON heartbeat_history(received_at);

-- 操作指示。画面が積み、実行担当のエージェントがハートビート応答で拾う
CREATE TABLE IF NOT EXISTS commands (
  id TEXT PRIMARY KEY,             -- UUID（二重実行防止のキー）
  env TEXT NOT NULL,               -- 対象の環境
  executor TEXT NOT NULL,          -- 実行するエージェント（'host' | 'vm1' | 'vm2'）
  action TEXT NOT NULL,            -- ホワイトリストのみ（shared/src/commands.ts）
  args TEXT,                       -- JSON（session_id など）
  status TEXT NOT NULL,            -- queued | running | done | failed | expired | canceled
  requested_by TEXT NOT NULL,      -- メール
  created_at INTEGER NOT NULL,
  not_before INTEGER,              -- ホスト再起動の取り消し猶予
  expires_at INTEGER NOT NULL,     -- これを過ぎて queued のままなら expired
  started_at INTEGER,
  finished_at INTEGER,
  output TEXT                      -- 結果の要約（秘密情報・パスを含めない）
);
CREATE INDEX IF NOT EXISTS idx_commands_executor_status ON commands(executor, status);
CREATE INDEX IF NOT EXISTS idx_commands_env_status ON commands(env, status);
CREATE INDEX IF NOT EXISTS idx_commands_created ON commands(created_at);

-- 監査ログ（全操作。画面に表示する）
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);

-- 復元用のセッション一覧。本人とオーナーにだけ返す（docs/spec.md 9章）
CREATE TABLE IF NOT EXISTS sessions (
  env TEXT NOT NULL,
  session_id TEXT NOT NULL,
  title TEXT,                      -- 先頭60文字まで。履歴・通知・監査ログには残さない
  started_at INTEGER,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (env, session_id)
);
CREATE INDEX IF NOT EXISTS idx_sessions_last_seen ON sessions(last_seen);

-- 通知の重複抑制（Cron が使う）
CREATE TABLE IF NOT EXISTS notify_state (
  key TEXT PRIMARY KEY,            -- 例: 'outage:host', 'disk:warn', 'rc_login:vm1'
  state TEXT,                      -- 直近に通知した状態
  updated_at INTEGER
);
