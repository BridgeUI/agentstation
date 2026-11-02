import type { Command, CommandAction, Env, MeResponse } from '@agentstation/shared';
import { COMMAND_SPECS, canOperate, isRcDirName, type RcPermissionMode } from '@agentstation/shared';
import { ApiFailure, api } from './api.js';
import { confirmDialog, hostnameDialog, sessionDialog } from './dialogs.js';
import { html } from './dom.js';
import { ACTION_LABEL, actionLabel } from './judge.js';
import { titleOf } from './people.js';

/**
 * 操作の実行。確認ダイアログ → POST /api/commands → 画面を更新。
 * 権限の判定はサーバー（403）。ここでボタンを出し分けるのは見た目の都合だけ。
 */

export interface OpDef {
  action: CommandAction;
  name: string;
  desc: string;
  button: string;
  danger?: boolean;
  confirmBody: string;
}

const BASE_OPS: OpDef[] = [
  {
    action: 'rc_restart',
    name: 'Remote Controlを立て直す',
    desc: 'claude remote-control を止めて、同じフォルダで起動し直します。止まってから約4時間以内なら、前のセッションも戻ります。',
    button: '立て直す',
    confirmBody: 'Remote Control を止めて起動し直します。進行中の会話は一度切れます。',
  },
  {
    action: 'session_restore',
    name: '前のセッションを戻す',
    desc: '記録しておいたセッションIDを選んで、そのセッションだけを戻します（止まってから約4時間以内）。',
    button: '選ぶ',
    confirmBody: '',
  },
  {
    action: 'claude_update',
    name: 'Claude Codeを更新',
    desc: 'claude update を実行し、Remote Controlを立て直して接続を確認します。普段は毎晩4時の夜間メンテナンスで自動で行います。',
    button: '更新',
    confirmBody:
      'claude update を実行し、Remote Control を立て直します。数分かかることがあります。',
  },
  {
    action: 'codex_restart',
    name: 'Codexを再起動',
    desc: '常駐できる構成の場合のみ有効です。確認は1回です。',
    button: '再起動',
    confirmBody: 'Codex の常駐を再起動します。',
  },
];

const HOST_OPS: OpDef[] = [
  {
    action: 'host_restart',
    name: 'ホストを再起動',
    desc: 'オーナーのみ。VMを止めてから再起動します。ホスト名の入力と、1分間の取り消し猶予があります。',
    button: '再起動…',
    danger: true,
    confirmBody:
      'Mac 本体を再起動します。VM も止まり、全員の Claude Code が数分間使えなくなります。次の画面でホスト名を入力します。',
  },
  {
    action: 'host_power_cycle',
    name: '電源を入れ直す（スマートプラグ）',
    desc: 'オーナーのみ。最後の手段です。Mac の電源ケーブルに挟んだ SwitchBot のプラグをオフにし、約 1 分後にオンにします。エージェントも SSH も効かないときだけ使えます（報告が 10 分以上途絶えているときだけ受け付けます）。強制電源断なので、ディスクや書きかけのファイルが壊れることがあります。',
    button: '入れ直す…',
    danger: true,
    confirmBody:
      'Mac の電源を強制的に切って入れ直します。保存していない作業は失われ、VM のイメージが壊れることもあります。戻るまで 3〜5 分かかります。次の画面でホスト名を入力します。',
  },
];

const VM_OPS: OpDef[] = [
  {
    action: 'vm_restart',
    name: 'VMを再起動',
    desc: 'tart stop のあと、launchd が自動で起動し直します。',
    button: '再起動',
    confirmBody: 'VM を停止し、launchd に起動し直させます。戻るまで 2 分ほどかかります。',
  },
  {
    action: 'vm_stop',
    name: 'VMを停止',
    desc: '自動起動も止めます。再開は「VMを起動」から行います。',
    button: '停止',
    confirmBody: 'VM を停止し、自動起動も止めます。再開するには「VMを起動」を押します。',
  },
  {
    action: 'vm_start',
    name: 'VMを起動',
    desc: '停止中の VM を起動し、自動起動も戻します。',
    button: '起動',
    confirmBody: 'VM を起動します。中の Claude Code が報告を始めるまで 2 分ほどかかります。',
  },
];

export function opsFor(env: Env): OpDef[] {
  return env === 'host' ? [...BASE_OPS, ...HOST_OPS] : [...BASE_OPS, ...VM_OPS];
}

export function canPress(me: MeResponse, env: Env, action: CommandAction): boolean {
  const spec = COMMAND_SPECS[action];
  if (!spec.targets.includes(env)) return false;
  if (spec.ownerOnly && me.role !== 'owner') return false;
  return canOperate(me, env);
}

export interface RunResult {
  ok: boolean;
  message?: string;
}

/** 確認 → 登録。エラーは本文をそのまま返す（409/403/400 など） */
export async function runOp(env: Env, op: OpDef, serverNow: number): Promise<RunResult> {
  const who = titleOf(env);
  let args: Command['args'] | undefined;

  if (op.action === 'session_restore') {
    let sessions;
    try {
      sessions = await api.sessions(env);
    } catch (e) {
      return { ok: false, message: msgOf(e) };
    }
    const id = await sessionDialog(sessions, serverNow);
    if (!id) return { ok: false };
    args = { session_id: id };
  } else {
    const ok = await confirmDialog({
      title: `${who}：${op.name}`,
      body: op.confirmBody,
      okLabel: op.danger ? '次へ' : op.button,
      ...(op.danger ? { danger: true } : {}),
    });
    if (!ok) return { ok: false };
  }

  let confirm_text: string | undefined;
  if (COMMAND_SPECS[op.action].confirm === 2) {
    const ok = await hostnameDialog(
      op.action === 'host_power_cycle'
        ? {
            title: '電源を入れ直す（最終確認）',
            note: '登録後 1 分間は取り消せます。プラグをオフにし、約 1 分後にオンにします。戻らないときは SwitchBot アプリで手動でオンにしてください。',
            okLabel: '電源の入れ直しを登録',
          }
        : {
            title: 'ホストを再起動（最終確認）',
            note: '登録後 1 分間は取り消せます。VM を止めてから再起動し、戻るまで数分かかります。',
            okLabel: '再起動を登録',
          },
    );
    if (!ok) return { ok: false };
    confirm_text = 'host';
  }

  try {
    await api.createCommand({
      id: crypto.randomUUID(),
      env,
      action: op.action,
      ...(args ? { args } : {}),
      ...(confirm_text ? { confirm_text } : {}),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: msgOf(e) };
  }
}

/** フォルダごとの Remote Control の起動・停止。起動は信頼の記録を含む。確認 1 回 → 登録 */
export async function runDirOp(
  env: Env,
  action: 'rc_start_dir' | 'rc_stop_dir',
  dir: string,
): Promise<RunResult> {
  const dialog = {
    rc_start_dir: {
      title: 'Remote Control を起動',
      body: `フォルダ「${dir}」を Claude Code の信頼済みフォルダとして記録し（そのマシンの ~/.claude.json）、そのフォルダを作業場所にした Remote Control を立ち上げます。信頼すると、そのフォルダにある CLAUDE.md・フック・設定が読み込まれます。Claude アプリにはフォルダ名で表示されます。`,
      okLabel: '起動',
    },
    rc_stop_dir: {
      title: 'Remote Control を停止',
      body: `フォルダ「${dir}」の Remote Control を止めます。進行中の会話は切れます。`,
      okLabel: '停止',
    },
  }[action];
  const ok = await confirmDialog({
    title: `${titleOf(env)}：${dialog.title}`,
    body: dialog.body,
    okLabel: dialog.okLabel,
  });
  if (!ok) return { ok: false };
  try {
    await api.createCommand({ id: crypto.randomUUID(), env, action, args: { dir } });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: msgOf(e) };
  }
}

export async function cancelOp(c: Command): Promise<RunResult> {
  const ok = await confirmDialog({
    title: `「${actionLabel(c.action)}」を取り消す`,
    body: 'まだ実行されていない指示を取り消します。',
    okLabel: '取り消す',
  });
  if (!ok) return { ok: false };
  try {
    await api.cancelCommand(c.id);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: msgOf(e) };
  }
}

export function msgOf(e: unknown): string {
  if (e instanceof ApiFailure) return e.message;
  return 'エラーが起きました';
}

/**
 * 実行中の指示の表示。queued の間は「取り消す」。host_restart は not_before までの残り秒数。
 * serverOffset = サーバーの now − 端末の Date.now()（端末の時計に依存しないため）
 */
/** 指示の対象（フォルダ名・権限モード）。無ければ '' */
export function commandTarget(c: Command): string {
  const a = c.args;
  if (!a) return '';
  if (a.dir) return a.dir;
  if (a.permission_mode)
    return a.permission_mode === 'bypassPermissions' ? '権限の確認を省く' : '権限を毎回確認する';
  return '';
}

/** 指示の名前。rc_mkdir は「作成して起動」かどうかで分ける */
export function commandName(c: Command): string {
  if (c.action === 'rc_mkdir' && c.args?.start) return 'フォルダを作成して起動';
  return ACTION_LABEL[c.action] ?? c.action;
}

export function activeBox(c: Command, serverOffset: number, canCancel: boolean): string {
  const now = Date.now() + serverOffset;
  const name = commandName(c);
  const target = commandTarget(c);
  let state: string;
  let dotClass = 's-warn';
  if (c.status === 'running') {
    state = '実行中…';
  } else if (c.not_before && c.not_before > now) {
    const left = Math.max(0, Math.ceil((c.not_before - now) / 1000));
    state = `${left}秒後に実行（それまで取り消せます）`;
    dotClass = 's-bad';
  } else if (c.executor === 'cloud') {
    state = '待機中（1 分以内に実行）';
  } else {
    state = '待機中（次の報告で実行）';
  }
  const by = c.requested_by.split('@')[0] ?? '';
  // 実行中・待機中は点の代わりに回す（処理が進んでいることを見せる）。取り消せるカウントダウンの間は点
  const mark = dotClass === 's-bad' ? 'dot' : 'spin';
  return html`
    <div class="active-box" data-command-id="${c.id}">
      <span class="label ${dotClass}"
        ><span class="${mark}" aria-hidden="true"></span
        ><b>${name}</b>${target ? html`<span class="mono">${target}</span>` : ''}<span class="muted"
          >${state} · ${by}</span
        ></span
      >
      ${
        c.status === 'queued' && canCancel
          ? html`<button type="button" class="btn" data-cancel="${c.id}">取り消す</button>`
          : ''
      }
    </div>
  `;
}

/** 作業フォルダ直下に新しいフォルダを作る（rc_mkdir）。名前を先に確かめ、確認 1 回 → 登録 */
export async function runMkdirOp(env: Env, dir: string, start: boolean): Promise<RunResult> {
  if (!isRcDirName(dir) || dir.startsWith('.')) {
    return {
      ok: false,
      message: 'フォルダ名は英数字で始め、英数字・空白・. _ - だけ、64 文字までにしてください',
    };
  }
  const ok = await confirmDialog({
    title: `${titleOf(env)}：フォルダを作成`,
    body: start
      ? `作業フォルダの直下に「${dir}」を作り、信頼済みフォルダとして記録して、そのまま Remote Control を立ち上げます。`
      : `作業フォルダの直下に「${dir}」を作ります。`,
    okLabel: start ? '作成して起動' : '作成',
  });
  if (!ok) return { ok: false };
  try {
    await api.createCommand({
      id: crypto.randomUUID(),
      env,
      action: 'rc_mkdir',
      args: start ? { dir, start: true } : { dir },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: msgOf(e) };
  }
}

/**
 * Claude Code 全体の既定の権限モードを切り替える（claude_permission_set）。確認 1 回 → 登録。
 * ~/.claude/settings.json を書き換えるだけで、動いている Remote Control は立て直さない
 */
export async function runClaudePermissionOp(env: Env, mode: RcPermissionMode): Promise<RunResult> {
  const on = mode === 'bypassPermissions';
  const ok = await confirmDialog({
    title: `${titleOf(env)}：Claude Code の既定で${on ? '権限の確認を省く' : '権限を毎回確認する'}`,
    body: on
      ? 'この Mac の ~/.claude/settings.json で、既定の権限モードを bypassPermissions にし、起動時の確認ダイアログも出さないようにします。ターミナルで claude を起動したとき、ファイルの書き込みやコマンド実行のたびに許可を求めなくなります。次に起動する claude から効きます（動いている Remote Control や会話は切れません）。'
      : 'この Mac の ~/.claude/settings.json で、既定の権限モードを default に戻します。次に起動する claude から、書き込みやコマンド実行のたびに許可を求めるようになります。基礎設定のこの項目は「要対応」になります。',
    okLabel: on ? '省く' : '毎回確認する',
  });
  if (!ok) return { ok: false };
  try {
    await api.createCommand({
      id: crypto.randomUUID(),
      env,
      action: 'claude_permission_set',
      args: { permission_mode: mode },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: msgOf(e) };
  }
}

/** Remote Control の権限モードを切り替える（rc_permission_set）。確認 1 回 → 登録。立て直しを伴う */
export async function runPermissionOp(env: Env, mode: RcPermissionMode): Promise<RunResult> {
  const on = mode === 'bypassPermissions';
  const ok = await confirmDialog({
    title: `${titleOf(env)}：${on ? '権限の確認を省く' : '権限を毎回確認する'}`,
    body: on
      ? 'Remote Control を bypassPermissions で起動し直します。Claude アプリでファイルの書き込みやコマンド実行のたびに許可を求めなくなります。進行中の会話は切れます（「前のセッションを戻す」で戻せます）。'
      : 'Remote Control を既定の権限モードで起動し直します。書き込みやコマンド実行のたびに Claude アプリで許可を求めるようになります。進行中の会話は切れます。',
    okLabel: on ? '省く' : '毎回確認する',
  });
  if (!ok) return { ok: false };
  try {
    await api.createCommand({
      id: crypto.randomUUID(),
      env,
      action: 'rc_permission_set',
      args: { permission_mode: mode },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: msgOf(e) };
  }
}
