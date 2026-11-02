-- ローカル確認用のサンプル状態。本番には入れない。
-- 使い方（worker/ で）:
--   npx wrangler d1 execute macmini-dashboard --local --file ui/dev-seed.sql
-- received_at は「いま」に寄せたいので、実行前に `strftime` で現在時刻を入れる。
-- シナリオの切り替えは下のコメントを参照（応答なし＝host の received_at を 15 分前にする、など）。

DELETE FROM heartbeats;
DELETE FROM sessions;
DELETE FROM commands;
DELETE FROM audit_log;

-- host（正常）
INSERT INTO heartbeats (env, received_at, payload) VALUES (
  'host',
  CAST(strftime('%s','now') AS INTEGER) * 1000 - 12000,
  json('{"env":"host","agent_version":"0.1.0","agent_started_at":1761800000000,"sent_at":1761890000000,
    "host":{"os_version":"26.1","tart_version":"2.27.0","boot_at":1761800000000,"cpu_cores":12,"mem_total_gb":24,"disk_total_gb":512,"cpu_pct":38,"mem_used_gb":13.4,"disk_used_gb":205},
    "claude":{"state":"running","rc_state":"connected","version":"2.1.0","channel":"stable","last_restart":1761854400000},
    "codex":{"state":"running"},
    "sessions":[],
    "maintenance":{"last_run_at":1761854400000,"last_result":"ok"},
    "rc_dirs":{"root":"workspace","available":["macmini-dashboard","example-site","notes"],
      "running":[
        {"dir":"macmini-dashboard","state":"running","name":"host-macmini-dashboard","started_at":1793440000000},
        {"dir":"example-site","state":"error","name":"host-example-site","detail":"not trusted"}
      ]},
    "setup":[
      {"key":"power.sleep","status":"ok","detail":"sleep=0"},
      {"key":"power.disksleep","status":"ok"},
      {"key":"power.autorestartatconnect","status":"ok"},
      {"key":"power.powernap","status":"ng","detail":"powernap=1"},
      {"key":"security.filevault","status":"ng","detail":"FileVault: On"},
      {"key":"login.autologin","status":"ok"},
      {"key":"update.macos_auto_install","status":"ok"},
      {"key":"update.appstore_auto","status":"unknown"},
      {"key":"sharing.ssh","status":"ok"},
      {"key":"sharing.vnc","status":"ng","detail":"port 5900 closed"},
      {"key":"sharing.smb_workspace","status":"ng","detail":"ゲスト許可（-g 000 にする）"},
      {"key":"network.ethernet","status":"ok"},
      {"key":"system.timezone","status":"ok","detail":"Asia/Tokyo"},
      {"key":"claude.logged_in","status":"ok"},
      {"key":"claude.autoupdater_off","status":"ok"},
      {"key":"claude.workdir","status":"ok"},
      {"key":"launchd.claude_rc","status":"ok"},
      {"key":"launchd.codex","status":"skip"},
      {"key":"launchd.vm1","status":"ok"},
      {"key":"launchd.vm2","status":"ok"},
      {"key":"cloudflared.running","status":"ok"},
      {"key":"sudoers.shutdown","status":"ng"},
      {"key":"timemachine.tart_excluded","status":"ok"},
      {"key":"disk.free","status":"ok","detail":"60% free"},
      {"key":"user.name","status":"ok"}
    ],
    "vms":[
      {"env":"vm1","vm_state":"running","ip":"192.168.64.10","usage":{"cpu_pct_of_host":20,"mem_gb":5.8,"disk_image_gb":82},"alloc":{"cpu":4,"mem_gb":6,"disk_gb":90}},
      {"env":"vm2","vm_state":"running","ip":"192.168.64.11","usage":{"cpu_pct_of_host":6,"mem_gb":3.4,"disk_image_gb":51},"alloc":{"cpu":4,"mem_gb":6,"disk_gb":90}}
    ]}')
);

-- vm1（正常）。要ログインにするなら "rc_state":"login_required"
INSERT INTO heartbeats (env, received_at, payload) VALUES (
  'vm1',
  CAST(strftime('%s','now') AS INTEGER) * 1000 - 20000,
  json('{"env":"vm1","agent_version":"0.1.0","agent_started_at":1761800100000,"sent_at":1761890000000,
    "guest":{"os_version":"26.1","boot_at":1761800100000,"disk_used_gb":40,"disk_total_gb":90},
    "claude":{"state":"running","rc_state":"connected","rc_permission_mode":"bypassPermissions","version":"2.1.0","channel":"stable","last_restart":1761854400000},
    "codex":{"state":"running"},
    "sessions":[],
    "rc_dirs":{"root":"workspace","available":["my-project","api-server","notes"],
      "running":[
        {"dir":"my-project","state":"running","name":"my-project","started_at":1793440000000}
      ]},
    "setup":[
      {"key":"power.sleep","status":"ok"},
      {"key":"power.disksleep","status":"ok"},
      {"key":"power.powernap","status":"ok"},
      {"key":"security.filevault","status":"ok"},
      {"key":"login.autologin","status":"ok"},
      {"key":"update.macos_auto_install","status":"ok"},
      {"key":"update.appstore_auto","status":"ok"},
      {"key":"sharing.ssh","status":"ok"},
      {"key":"sharing.vnc","status":"ok"},
      {"key":"sharing.smb_workspace","status":"ok","detail":"workspace · port 445 open"},
      {"key":"system.timezone","status":"ok"},
      {"key":"claude.logged_in","status":"ok"},
      {"key":"claude.autoupdater_off","status":"ok"},
      {"key":"claude.default_bypass","status":"ok"},
      {"key":"claude.workdir","status":"ok"},
      {"key":"launchd.claude_rc","status":"ok"},
      {"key":"launchd.codex","status":"skip"},
      {"key":"disk.free","status":"ok"},
      {"key":"user.name","status":"ok"}
    ]}')
);

-- vm2（setup は未収集のまま）（正常）。Claude 停止にするなら "state":"stopped","rc_state":"reconnecting"
INSERT INTO heartbeats (env, received_at, payload) VALUES (
  'vm2',
  CAST(strftime('%s','now') AS INTEGER) * 1000 - 30000,
  json('{"env":"vm2","agent_version":"0.1.0","agent_started_at":1761800200000,"sent_at":1761890000000,
    "guest":{"os_version":"26.1","boot_at":1761800200000,"disk_used_gb":28,"disk_total_gb":90},
    "claude":{"state":"running","rc_state":"connected","version":"2.1.0","channel":"stable","last_restart":1761854400000},
    "codex":{"state":"stopped"},
    "sessions":[]}')
);

-- 復元用セッション（タイトルはこのダイアログにだけ出る）
INSERT INTO sessions (env, session_id, title, started_at, last_seen) VALUES
  ('host', '3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b', 'ダッシュボードの画面を作る', CAST(strftime('%s','now') AS INTEGER) * 1000 - 7200000, CAST(strftime('%s','now') AS INTEGER) * 1000 - 60000),
  ('host', '8d1e2f3a-4b5c-4d6e-8f7a-9b0c1d2e3f4a', 'launchd の plist を整理', CAST(strftime('%s','now') AS INTEGER) * 1000 - 86400000, CAST(strftime('%s','now') AS INTEGER) * 1000 - 3600000),
  ('vm1', 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', 'API のテストを書く', CAST(strftime('%s','now') AS INTEGER) * 1000 - 3600000, CAST(strftime('%s','now') AS INTEGER) * 1000 - 120000);

-- 操作履歴
INSERT INTO audit_log (at, actor_email, action, target, detail) VALUES
  (CAST(strftime('%s','now') AS INTEGER) * 1000 - 5400000, 'hanako@example.invalid', 'command.create', 'vm1', 'rc_restart'),
  (CAST(strftime('%s','now') AS INTEGER) * 1000 - 5340000, 'agent:vm1', 'command.running', 'vm1', 'rc_restart'),
  (CAST(strftime('%s','now') AS INTEGER) * 1000 - 5300000, 'agent:vm1', 'command.done', 'vm1', '11111111-2222-4333-8444-555555555555'),
  (CAST(strftime('%s','now') AS INTEGER) * 1000 - 3600000, 'jiro@example.invalid', 'command.create', 'vm2', 'vm_restart'),
  (CAST(strftime('%s','now') AS INTEGER) * 1000 - 3540000, 'agent:host', 'command.running', 'vm2', 'vm_restart'),
  (CAST(strftime('%s','now') AS INTEGER) * 1000 - 3500000, 'agent:host', 'command.failed', 'host', '22222222-3333-4444-8555-666666666666'),
  (CAST(strftime('%s','now') AS INTEGER) * 1000 - 90000000, 'taro@example.com', 'command.create', 'host', 'claude_update'),
  (CAST(strftime('%s','now') AS INTEGER) * 1000 - 89000000, 'taro@example.com', 'command.cancel', 'host', 'claude_update');
