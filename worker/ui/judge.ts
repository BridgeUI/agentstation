import type {
  CommandAction,
  EnvStatus,
  Heartbeat,
  HostHeartbeat,
  Liveness,
  StatusResponse,
  VmView,
} from '@agentstation/shared';
import { isHostHeartbeat } from '@agentstation/shared';
import { PEOPLE, shortOf } from './people.js';
import { minutesSince } from './format.js';

/** 表示の判定（docs/spec.md 5章）。サーバーが返した liveness と中身を合わせて決める。 */

export type Tone = 'ok' | 'warn' | 'bad' | 'none';

export interface Verdict {
  tone: Tone;
  label: string;
  /** 一覧のバナーに出す（問題があるときだけ） */
  banner?: { level: 'warn' | 'error'; title: string; body: string };
}

export interface Row {
  label: string;
  value: string;
  tone: Tone;
}

export function hostLiveness(s: StatusResponse): Liveness {
  return s.envs.find((e) => e.env === 'host')?.liveness ?? 'unknown';
}

export function hostHeartbeat(s: StatusResponse): HostHeartbeat | null {
  const hb = s.envs.find((e) => e.env === 'host')?.heartbeat ?? null;
  return hb && isHostHeartbeat(hb) ? hb : null;
}

export function judge(e: EnvStatus, s: StatusResponse): Verdict {
  const hostLive = hostLiveness(s);
  const who = shortOf(e.env);
  const owner = PEOPLE[e.env].name;

  // host の報告が途絶えたら全環境「応答なし」
  if (hostLive === 'unresponsive' || (e.env === 'host' && e.liveness === 'unresponsive')) {
    return { tone: 'none', label: '応答なし' };
  }

  if (e.env !== 'host') {
    const vm = e.vm_view;
    if (vm?.vm_state === 'stopped') return { tone: 'none', label: '停止' };
    if (vm?.vm_state === 'starting') return { tone: 'none', label: '起動中' };
    // VM のエージェントだけ途絶えた
    if (e.liveness === 'unresponsive' && hostLive === 'ok') {
      return {
        tone: 'warn',
        label: '要確認（エージェント停止）',
        banner: {
          level: 'warn',
          title: `${who}のエージェントから報告が届いていません`,
          body: 'VM は動いていますが、中のエージェントが止まっています。「VMを再起動」か、SSHで入ってエージェントを再起動してください。',
        },
      };
    }
  }

  if (e.liveness === 'delayed') return { tone: 'warn', label: '遅延' };
  if (e.liveness === 'unknown' || !e.heartbeat) return { tone: 'none', label: '未受信' };
  if (e.liveness === 'unresponsive') return { tone: 'none', label: '応答なし' };

  const hb = e.heartbeat;
  if (hb.claude.rc_state === 'login_required') {
    return {
      tone: 'bad',
      label: '要ログイン',
      banner: {
        level: 'error',
        title: `${who}で再ログインが必要です`,
        body: 'Claude Codeのログインが切れ、Remote Controlにつながりません。SSHで入り、claude auth login をし直してください。',
      },
    };
  }
  if (hb.claude.state === 'stopped') {
    return {
      tone: 'warn',
      label: '要確認',
      banner: {
        level: 'warn',
        title: `${who}のClaude Codeが停止しています`,
        body: `launchdが自動で再起動を試みています。続く場合は${owner} の環境の画面から「Remote Controlを立て直す」を押してください。`,
      },
    };
  }
  if (hb.claude.rc_state === 'reconnecting') return { tone: 'warn', label: '要確認' };
  return { tone: 'ok', label: '正常' };
}

/** 全体ステータス（見出し横の丸） */
export function overall(s: StatusResponse): { tone: Tone; label: string } {
  const hostLive = hostLiveness(s);
  if (hostLive === 'unresponsive') return { tone: 'none', label: '応答なし' };
  if (hostLive === 'unknown') return { tone: 'none', label: '未受信' };
  const vs = s.envs.map((e) => judge(e, s));
  const issues = vs.filter((v) => v.tone !== 'ok');
  if (issues.length === 0) return { tone: 'ok', label: 'すべて正常' };
  const tone: Tone = issues.some((v) => v.tone === 'bad') ? 'bad' : 'warn';
  return { tone, label: `${issues.length}件の問題` };
}

/** 一覧のバナー。サーバーの alerts ＋ 環境ごとの問題 */
export function banners(
  s: StatusResponse,
): { level: 'warn' | 'error'; title: string; body: string }[] {
  const out: { level: 'warn' | 'error'; title: string; body: string }[] = [];
  const hostLive = hostLiveness(s);
  for (const a of s.alerts) {
    if (
      a.message.startsWith('Mac') &&
      hostLive === 'unresponsive' &&
      s.host_received_at !== null
    ) {
      out.push({
        level: 'error',
        title: `Macから${minutesSince(s.host_received_at, s.now)}分間応答がありません`,
        body: outageAdvice(s),
      });
    } else if (hostLive === 'unknown' && a.level === 'warn' && s.host_received_at === null) {
      out.push({
        level: 'warn',
        title: a.message,
        body: 'エージェントがまだ一度も報告していません。各マシンで launchd のエージェントが動いているか確認してください。',
      });
    } else {
      out.push({ level: a.level, title: a.message, body: '' });
    }
  }
  for (const e of s.envs) {
    const v = judge(e, s);
    if (v.banner) out.push(v.banner);
  }
  return out;
}

/** これ未満の W なら「ほぼ 0」（worker/src/cron/plug.ts と同じ値） */
export const PLUG_OFF_LIKE_W = 1;

/**
 * host が応答しないときの助言。スマートプラグの様子で「回線」「電源」「エージェント」のどれらしいかを分ける。
 * 入れ直しはオーナーだけなので、ボタンの場所（Taro の環境 › 操作）を示す
 */
function outageAdvice(s: StatusResponse): string {
  const p = s.plug;
  const cycle = '「Taro の環境 › 操作」の「電源を入れ直す」で復旧できます（オーナーのみ）。';
  if (!s.plug_enabled || !p) {
    return 'SSHで入れるか確認し、入れなければスマートプラグで電源を入れ直してください。';
  }
  if (!p.ok) {
    return 'スマートプラグにも届きません。自宅の回線かルーターが落ちている可能性が高いので、戻るまで待ってください。';
  }
  if (p.state === 'off') return `スマートプラグがオフで、Mac に電源が来ていません。${cycle}`;
  if (p.state === 'on' && p.watts !== null && p.watts < PLUG_OFF_LIKE_W) {
    return `プラグはオンですが消費電力がほぼ 0 です。Mac が落ちている可能性があります。${cycle}`;
  }
  return `プラグはオンで通電しています${p.watts !== null ? `（${p.watts}W）` : ''}。SSHで入れるか確認し、入れなければ${cycle}`;
}

/** スマートプラグの表示（概要のタイルと詳細の行） */
export function plugRow(s: StatusResponse): Row & { sub: string } {
  const p = s.plug;
  if (!s.plug_enabled) return { label: '電源プラグ', value: '未設定', tone: 'none', sub: '' };
  if (!p) return { label: '電源プラグ', value: '未取得', tone: 'none', sub: '' };
  const when = `${minutesSince(p.checked_at, s.now)}分前に確認`;
  if (!p.ok) return { label: '電源プラグ', value: '届かない', tone: 'warn', sub: when };
  if (p.state === 'off') return { label: '電源プラグ', value: 'オフ', tone: 'bad', sub: when };
  if (p.state === 'unknown')
    return { label: '電源プラグ', value: '状態不明', tone: 'none', sub: when };
  const w = p.watts === null ? '' : `${p.watts}W · `;
  const tone: Tone = p.watts !== null && p.watts < PLUG_OFF_LIKE_W ? 'warn' : 'ok';
  return { label: '電源プラグ', value: 'オン', tone, sub: `${w}${when}` };
}

const CLAUDE_STATE: Record<Heartbeat['claude']['state'], [string, Tone]> = {
  running: ['稼働中', 'ok'],
  stopped: ['停止中・再起動待ち', 'warn'],
  unknown: ['不明', 'none'],
};
const RC_STATE: Record<Heartbeat['claude']['rc_state'], [string, Tone]> = {
  connected: ['接続中', 'ok'],
  reconnecting: ['再接続待ち', 'warn'],
  login_required: ['要ログイン', 'bad'],
  unknown: ['不明', 'none'],
};
const CODEX_STATE: Record<Heartbeat['codex']['state'], [string, Tone]> = {
  running: ['稼働中', 'ok'],
  stopped: ['停止', 'none'],
  unknown: ['不明', 'none'],
};
const VM_STATE: Record<VmView['vm_state'], [string, Tone]> = {
  running: ['稼働中', 'ok'],
  starting: ['起動中', 'none'],
  stopped: ['停止', 'none'],
  unknown: ['不明', 'none'],
};

/** カードの4行（Claude Code / Remote Control / Codex / VM またはエージェント） */
export function rows(e: EnvStatus, s: StatusResponse): Row[] {
  const v = judge(e, s);
  const down = v.label === '応答なし' || v.label === '未受信';
  const hb = down ? null : e.heartbeat;
  const r = (label: string, pair: [string, Tone] | null): Row =>
    pair ? { label, value: pair[0], tone: pair[1] } : { label, value: '不明', tone: 'none' };

  const claude = r('Claude Code', hb ? CLAUDE_STATE[hb.claude.state] : null);
  const rc = r('Remote Control', hb ? RC_STATE[hb.claude.rc_state] : null);
  const codex = r('Codex', hb ? CODEX_STATE[hb.codex.state] : null);

  let fourth: Row;
  if (e.env === 'host') {
    const live = e.liveness;
    fourth =
      live === 'ok'
        ? { label: 'エージェント', value: '60秒ごとに報告', tone: 'ok' }
        : live === 'delayed'
          ? { label: 'エージェント', value: '報告が遅れている', tone: 'warn' }
          : { label: 'エージェント', value: live === 'unknown' ? '未受信' : '停止', tone: 'none' };
  } else {
    const vm = hostLiveness(s) === 'unresponsive' ? null : e.vm_view;
    fourth = r('VM', vm ? VM_STATE[vm.vm_state] : null);
    if (vm && vm.vm_state === 'running' && e.liveness === 'unresponsive') {
      fourth = { label: 'VM', value: '稼働中（エージェント停止）', tone: 'warn' };
    }
  }
  if (e.env !== 'host' && e.vm_view && e.vm_view.vm_state !== 'running' && !down) {
    // VM が止まっていれば中のプロセスは不明
    return [
      { ...claude, value: '—', tone: 'none' },
      { ...rc, value: '—', tone: 'none' },
      { ...codex, value: '—', tone: 'none' },
      fourth,
    ];
  }
  return [claude, rc, codex, fourth];
}

export interface Share {
  cpu: number | null;
  mem: number | null;
  disk: number | null;
}

/**
 * 各環境の使用量（Mac 全体に対する割合）。
 * host（本体）は全体から VM（0〜2 台）の分を引いた値。
 */
export function shares(s: StatusResponse): Record<string, Share> {
  const hb = hostHeartbeat(s);
  const out: Record<string, Share> = {};
  if (!hb || hostLiveness(s) === 'unresponsive') {
    for (const e of s.envs) out[e.env] = { cpu: null, mem: null, disk: null };
    return out;
  }
  const h = hb.host;
  const total = {
    cpu: h.cpu_pct ?? null,
    mem: pctOf(h.mem_used_gb, h.mem_total_gb),
    disk: pctOf(h.disk_used_gb, h.disk_total_gb),
  };
  let vmCpu = 0,
    vmMem = 0,
    vmDisk = 0;
  for (const e of s.envs) {
    if (e.env === 'host') continue;
    const v = e.vm_view;
    const cpu = v?.usage.cpu_pct_of_host ?? null;
    const mem = pctOf(v?.usage.mem_gb, h.mem_total_gb);
    const disk = pctOf(v?.usage.disk_image_gb, h.disk_total_gb);
    out[e.env] = { cpu, mem, disk };
    vmCpu += cpu ?? 0;
    vmMem += mem ?? 0;
    vmDisk += disk ?? 0;
  }
  out.host = {
    cpu: total.cpu === null ? null : Math.max(0, Math.round(total.cpu - vmCpu)),
    mem: total.mem === null ? null : Math.max(0, Math.round(total.mem - vmMem)),
    disk: total.disk === null ? null : Math.max(0, Math.round(total.disk - vmDisk)),
  };
  return out;
}

function pctOf(used: number | undefined, total: number | undefined): number | null {
  if (used === undefined || total === undefined || !(total > 0)) return null;
  return Math.max(0, Math.min(100, Math.round((used / total) * 100)));
}

/** 操作の日本語名（監査ログ・カードの表示用） */
export const ACTION_LABEL: Record<CommandAction, string> = {
  rc_restart: 'Remote Controlを立て直す',
  session_restore: '前のセッションを戻す',
  rc_start_dir: 'フォルダの Remote Control を起動',
  rc_stop_dir: 'フォルダの Remote Control を停止',
  rc_mkdir: 'フォルダを作成',
  rc_permission_set: 'Remote Control の権限モードを変更',
  claude_permission_set: 'Claude Code の既定の権限モードを変更',
  claude_update: 'Claude Codeを更新',
  codex_restart: 'Codexを再起動',
  vm_restart: 'VMを再起動',
  vm_stop: 'VMを停止',
  vm_start: 'VMを起動',
  host_restart: 'ホストを再起動',
  host_power_cycle: '電源を入れ直す（スマートプラグ）',
};

/** 廃止した操作の名前（履歴にだけ残る）。rc_trust_dir は 2026-11-01 に「起動」へ統合 */
const LEGACY_ACTION_LABEL: Record<string, string> = {
  rc_trust_dir: 'フォルダを信頼して Remote Control を起動',
};

export function actionLabel(a: string | null | undefined): string {
  if (!a) return '—';
  return (ACTION_LABEL as Record<string, string>)[a] ?? LEGACY_ACTION_LABEL[a] ?? a;
}
