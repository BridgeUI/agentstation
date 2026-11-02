import {
  SESSION_TITLE_MAX,
  type ClaudeStatus,
  type CodexStatus,
  type Env,
  type Heartbeat,
  type HostHeartbeat,
  type MaintenanceStatus,
  type RcDirs,
  type SessionInfo,
  type SetupCheck,
  type VmEnv,
  type VmHeartbeat,
  type VmView,
} from '@macmini/shared';

/** ハートビートの組み立て（純粋関数）。docs/spec.md 4.4 の形 */
export interface HeartbeatParts {
  env: Env;
  agentVersion: string;
  agentStartedAt: number;
  sentAt: number;
  claude: ClaudeStatus;
  codex: CodexStatus;
  sessions: SessionInfo[];
  maintenance?: MaintenanceStatus;
  /** 基礎設定のチェック（collect/setup.ts）。未収集なら省く */
  setup?: SetupCheck[];
  /** フォルダを選んで起動する RC（collect/rcdirs.ts） */
  rcDirs?: RcDirs;
  host?: HostHeartbeat['host'];
  vms?: VmView[];
  guest?: VmHeartbeat['guest'];
}

export function buildHeartbeat(p: HeartbeatParts): Heartbeat {
  const base = {
    agent_version: p.agentVersion,
    agent_started_at: p.agentStartedAt,
    sent_at: p.sentAt,
    claude: p.claude,
    codex: p.codex,
    sessions: p.sessions.map(trimSession),
    ...(p.maintenance ? { maintenance: p.maintenance } : {}),
    ...(p.setup ? { setup: p.setup } : {}),
    ...(p.rcDirs ? { rc_dirs: p.rcDirs } : {}),
  };
  if (p.env === 'host') {
    return { env: 'host', ...base, host: p.host ?? {}, vms: p.vms ?? [] };
  }
  return { env: p.env as VmEnv, ...base, guest: p.guest ?? {} };
}

/** タイトルは先頭 60 文字まで（docs/spec.md 9章） */
export function trimSession(s: SessionInfo): SessionInfo {
  const out: SessionInfo = { id: s.id };
  if (s.title !== undefined) out.title = [...s.title].slice(0, SESSION_TITLE_MAX).join('');
  if (s.started_at !== undefined) out.started_at = s.started_at;
  return out;
}
