import type { AuditEntry, Millis } from '@agentstation/shared';
import { isEnv } from '@agentstation/shared';
import { dayTime } from './format.js';
import { html, raw } from './dom.js';
import { actionLabel } from './judge.js';
import { PEOPLE, shortOf } from './people.js';

/**
 * 監査ログの1行を画面の言葉に直す。
 * サーバーの action は command.create / command.cancel（人）、command.running / command.done / command.failed（エージェント）。
 * detail は create/cancel/running では操作名、done/failed では指示の ID。
 * TODO(API): done/failed の detail にも操作名（と対象の環境）が入ると、ここで ID を見せずに済む。
 */
export interface AuditView {
  time: string;
  op: string;
  target: string;
  actor: string;
  result: string;
  resultTone: 'ok' | 'bad' | 'muted' | '';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function auditView(a: AuditEntry, now: Millis): AuditView {
  // VNC パスワードの表示（値は記録していない。docs/spec.md 13章 #16）
  if (a.action === 'vnc.password.view') {
    return {
      time: dayTime(a.at, now),
      op: 'VNC パスワードを表示',
      target: a.target && isEnv(a.target) ? shortOf(a.target) : (a.target ?? '—'),
      actor: actorName(a.actor_email),
      result: '表示',
      resultTone: 'muted',
    };
  }
  if (a.action === 'notify.test') {
    const ok = a.detail === 'sent';
    return {
      time: dayTime(a.at, now),
      op: 'Slack にテスト通知',
      target: 'Slack',
      actor: actorName(a.actor_email),
      result: ok ? '送信' : '失敗',
      resultTone: ok ? 'muted' : 'bad',
    };
  }
  const [, verb] = a.action.split('.');
  const detail = a.detail ?? '';
  const op = UUID_RE.test(detail) ? `指示 ${detail.slice(0, 8)}` : actionLabel(detail || a.action);
  const target = a.target && isEnv(a.target) ? shortOf(a.target) : (a.target ?? '—');
  const actor = actorName(a.actor_email);
  const map: Record<string, [string, AuditView['resultTone']]> = {
    create: ['受付', ''],
    cancel: ['取り消し', 'muted'],
    running: ['実行中', ''],
    done: ['完了', ''],
    failed: ['失敗', 'bad'],
    expired: ['期限切れ', 'muted'],
  };
  const [result, resultTone] = map[verb ?? ''] ?? [a.action, ''];
  return { time: dayTime(a.at, now), op, target, actor, result, resultTone };
}

/** メールアドレスはそのまま出さず、人の名前かエージェント名にする */
export function actorName(email: string): string {
  if (email.startsWith('agent:')) {
    const env = email.slice('agent:'.length);
    return isEnv(env) ? `エージェント（${env}）` : 'エージェント';
  }
  // Worker 自身が実行したもの（スマートプラグ。docs/spec.md 6.1）
  if (email.startsWith('worker:')) return 'ダッシュボード';
  const local = email.split('@')[0] ?? email;
  const hit = Object.values(PEOPLE).find((p) => p.name.toLowerCase() === local.toLowerCase());
  return hit ? hit.name : local;
}

export function auditRows(list: AuditEntry[], now: Millis): string {
  if (list.length === 0)
    return html`<tr>
      <td colspan="5" class="empty">まだ操作はありません</td>
    </tr>`;
  return list
    .map((a) => {
      const v = auditView(a, now);
      const cls = v.resultTone === 'bad' ? 's-bad' : v.resultTone === 'muted' ? 'muted' : '';
      return html`<tr>
        <td class="time">${v.time}</td>
        <td>${v.op}</td>
        <td>${v.target}</td>
        <td>${v.actor}</td>
        <td class="r ${cls}">${v.result}</td>
      </tr>`;
    })
    .join('');
}

/** 「このマシンの履歴」「最近のイベント」用の1行 */
export function eventLine(time: string, text: string): string {
  return html`<div><span class="t">${time}</span><span>${raw(text)}</span></div>`;
}
