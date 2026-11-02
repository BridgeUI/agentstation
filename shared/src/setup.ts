import type { Env } from './env.js';

/**
 * Mac の基礎設定のチェック（docs/spec.md 3.2、docs/setup-mac.md）。
 * エージェントが毎回のハートビートで `setup` として送り、画面の各環境ページに「基礎設定」として出す。
 * 値には秘密情報・パス（/Users/…）を入れない。
 */

export type SetupStatus = 'ok' | 'ng' | 'unknown' | 'skip';

export interface SetupCheck {
  key: SetupCheckKey;
  status: SetupStatus;
  /** 短い補足（例: "sleep=1"、"port 22 closed"）。パス・メール・トークンは入れない */
  detail?: string;
}

export const SETUP_CHECK_KEYS = [
  'power.sleep',
  'power.disksleep',
  'power.autorestartatconnect',
  'power.powernap',
  'security.filevault',
  'login.autologin',
  'update.macos_auto_install',
  'update.appstore_auto',
  'sharing.ssh',
  'sharing.vnc',
  'sharing.smb_workspace',
  'network.ethernet',
  'system.timezone',
  'claude.logged_in',
  'claude.autoupdater_off',
  'claude.default_bypass',
  'claude.workdir',
  'launchd.claude_rc',
  'launchd.codex',
  'launchd.vm1',
  'launchd.vm2',
  'cloudflared.running',
  'sudoers.shutdown',
  'timemachine.tart_excluded',
  'disk.free',
  'user.name',
] as const;
export type SetupCheckKey = (typeof SETUP_CHECK_KEYS)[number];

export function isSetupCheckKey(x: unknown): x is SetupCheckKey {
  return typeof x === 'string' && (SETUP_CHECK_KEYS as readonly string[]).includes(x);
}

export interface SetupCheckSpec {
  /** 画面に出す名前 */
  label: string;
  /** true なら Taro（または本人）がシステム設定などで手で行う項目 */
  manual: boolean;
  /** どこで直すか（短く） */
  how: string;
  /** どの環境で確認するか */
  envs: readonly Env[];
}

const ALL: readonly Env[] = ['host', 'vm1', 'vm2'];
const HOST: readonly Env[] = ['host'];

export const SETUP_CHECK_SPECS: Record<SetupCheckKey, SetupCheckSpec> = {
  'power.sleep': { label: 'スリープ無効', manual: false, how: 'sudo pmset -a sleep 0', envs: ALL },
  'power.disksleep': {
    label: 'ディスクのスリープ無効',
    manual: false,
    how: 'sudo pmset -a disksleep 0',
    envs: ALL,
  },
  // 「停電後に自動的に起動」（autorestart）ではなく「常に」（autorestartatconnect）。
  // autorestart は電源が切れる前に動いていたときだけ戻るので、意図してシャットダウンしたあとにスマートプラグで
  // 電源を入れ直しても起動しない（2026-11-01 オーナーの指摘で変更。docs/spec.md 3.2）
  'power.autorestartatconnect': {
    label: '電源が入ったら常に自動的に起動',
    manual: false,
    how: 'sudo pmset -a autorestartatconnect 1（システム設定 › エネルギー › 自動的に起動：常に）',
    envs: HOST,
  },
  'power.powernap': {
    label: 'Power Nap オフ',
    manual: false,
    how: 'sudo pmset -a powernap 0',
    envs: ALL,
  },
  'security.filevault': {
    label: 'FileVault オフ',
    manual: true,
    how: 'システム設定 › プライバシーとセキュリティ › FileVault',
    envs: ALL,
  },
  'login.autologin': {
    label: '自動ログイン',
    manual: true,
    how: 'システム設定 › ユーザとグループ › 自動ログイン',
    envs: ALL,
  },
  'update.macos_auto_install': {
    label: 'macOS 自動インストール オフ',
    manual: false,
    how: 'defaults write com.apple.SoftwareUpdate …（setup-mac.md）',
    envs: ALL,
  },
  'update.appstore_auto': {
    label: 'App Store 自動更新 オフ',
    manual: false,
    how: 'sudo defaults write /Library/Preferences/com.apple.commerce AutoUpdate -bool false（エージェントはシステム側の /Library/Preferences を見る）',
    envs: ALL,
  },
  'sharing.ssh': {
    label: 'リモートログイン（SSH）オン',
    manual: true,
    how: 'システム設定 › 一般 › 共有 › リモートログイン',
    envs: ALL,
  },
  'sharing.vnc': {
    label: '画面共有（VNC）オン',
    manual: true,
    how: 'システム設定 › 一般 › 共有 › 画面共有（VNC パスワードも）',
    envs: ALL,
  },
  // iPhone の「ファイル」アプリ用（smb://<内部IP>/workspace。cloudflare/warp/setup.md 6-5）。
  // 445 が開いている、`workspace` の共有がある（ゲスト不可）、利用者に SMB-NT ハッシュがある、の 3 つが揃って ok
  'sharing.smb_workspace': {
    label: 'ファイル共有（SMB）で workspace を公開',
    manual: true,
    how: 'sudo bash mac/scripts/smb-workspace.sh（パスワードを聞かれる）',
    envs: ALL,
  },
  'network.ethernet': {
    label: '有線 LAN で接続',
    manual: true,
    how: 'Ethernet をつなぎ、Wi‑Fi を優先にしない',
    envs: HOST,
  },
  'system.timezone': {
    label: 'タイムゾーン Asia/Tokyo',
    manual: true,
    how: 'システム設定 › 一般 › 日付と時刻',
    envs: ALL,
  },
  'claude.logged_in': {
    label: 'Claude Code にログイン済み',
    manual: true,
    how: 'claude auth login（その環境のアカウントで）',
    envs: ALL,
  },
  'claude.autoupdater_off': {
    label: 'Claude の自動更新 オフ',
    manual: false,
    how: '~/.claude/settings.json に DISABLE_AUTOUPDATER=1',
    envs: ALL,
  },
  'claude.default_bypass': {
    label: 'Claude Code の既定で権限の確認を省く',
    manual: false,
    how: 'ダッシュボードの「操作」でオン（~/.claude/settings.json の permissions.defaultMode と skipDangerousModePermissionPrompt）',
    envs: ALL,
  },
  'claude.workdir': {
    label: '作業フォルダが適切',
    manual: true,
    how: 'Desktop・Documents・Downloads 以外（例: ~/workspace）に作り、一度 claude を起動して信頼する',
    envs: ALL,
  },
  'launchd.claude_rc': {
    label: 'Remote Control の常駐（launchd）',
    manual: false,
    how: 'launchctl bootstrap gui/<uid> ~/Library/LaunchAgents/com.example.claude-rc.plist',
    envs: ALL,
  },
  'launchd.codex': {
    label: 'Codex の常駐（ChatGPT アプリ or launchd）',
    manual: false,
    how: 'ChatGPT アプリを開いておく（ログイン項目に入れると再起動後も開く。config の codex_app）。CLI の daemon を使うなら launchd（verify.md C-5）',
    envs: ALL,
  },
  'launchd.vm1': {
    label: 'vm1 の自動起動（launchd）',
    manual: false,
    how: 'launchctl bootstrap gui/<uid> ~/Library/LaunchAgents/com.example.tart-vm1.plist',
    envs: HOST,
  },
  'launchd.vm2': {
    label: 'vm2 の自動起動（launchd）',
    manual: false,
    how: 'launchctl bootstrap gui/<uid> ~/Library/LaunchAgents/com.example.tart-vm2.plist',
    envs: HOST,
  },
  'cloudflared.running': {
    label: 'cloudflared（Tunnel）が動作中',
    manual: false,
    how: 'sudo launchctl bootstrap system /Library/LaunchDaemons/com.cloudflare.cloudflared.plist',
    envs: HOST,
  },
  'sudoers.shutdown': {
    label: 'ホスト再起動の sudoers',
    manual: false,
    how: 'mac/sudoers.d/macmini-agent を /etc/sudoers.d/ に',
    envs: HOST,
  },
  'timemachine.tart_excluded': {
    label: 'VM イメージを Time Machine から除外',
    manual: false,
    how: 'tmutil addexclusion ~/.tart',
    envs: HOST,
  },
  'disk.free': {
    label: 'ディスクの空き（15% 以上）',
    manual: false,
    how: '不要なファイルを消す。VM イメージの肥大に注意',
    envs: ALL,
  },
  'user.name': {
    label: 'ユーザー名がメールの @ 前と一致',
    manual: true,
    how: 'ユーザー名を変えるか、Access のメールを合わせる',
    envs: ALL,
  },
};

/** その環境で確認すべき項目 */
export function setupKeysFor(env: Env): SetupCheckKey[] {
  return SETUP_CHECK_KEYS.filter((k) => SETUP_CHECK_SPECS[k].envs.includes(env));
}

export interface SetupSummary {
  total: number;
  ok: number;
  ng: number;
  unknown: number;
  /** ng のうち手動設定が必要なもの */
  manualNg: SetupCheckKey[];
}

export function summarizeSetup(checks: readonly SetupCheck[]): SetupSummary {
  const s: SetupSummary = { total: 0, ok: 0, ng: 0, unknown: 0, manualNg: [] };
  for (const c of checks) {
    if (c.status === 'skip') continue;
    s.total++;
    if (c.status === 'ok') s.ok++;
    else if (c.status === 'ng') {
      s.ng++;
      if (SETUP_CHECK_SPECS[c.key].manual) s.manualNg.push(c.key);
    } else s.unknown++;
  }
  return s;
}
