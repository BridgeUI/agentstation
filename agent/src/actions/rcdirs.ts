import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { isRcDirName } from '@agentstation/shared';
import { applyProjectTrust, realTrust } from '../claudetrust.js';
import { failOutcome, okOutcome, type ActionContext, type ActionOutcome } from './context.js';

/**
 * rc_start_dir / rc_stop_dir / rc_mkdir：フォルダを選んで追加の Remote Control を起動・停止、フォルダの作成（rcdirs/manager.ts）。
 *
 * 起動＝そのフォルダを信頼する、という前提（docs/spec.md 13章 #21。2026-11-01 オーナーの決定）。起動（作成後の起動も）のときは
 * 必ず先に Claude Code の信頼を記録する（~/.claude.json の projects[<実体パス>].hasTrustDialogAccepted だけ。claudetrust.ts）。
 * claude はフォルダの信頼を「cwd そのもの」か「同じ git リポジトリ内の信頼済みの祖先」でしか認めないので、空フォルダで
 * 起動できても、中に clone したあとの起動し直しで「Workspace not trusted」になる。先に記録しておけばそれが起きない。
 * ダッシュボードで本人・オーナーが「起動」を押した意思を、対話起動の信頼ダイアログで「はい」と答えたのと同じ形で書く
 * （同意プロンプトへの y と同じ考え方。AI が自発的にフォルダを信頼する経路は無い）。
 */

/** 作業フォルダ直下の dir の信頼を記録する。既に信頼済みなら何も書かない */
function ensureTrusted(
  ctx: ActionContext,
  dir: string,
  commandId: string,
): { ok: true; changed: boolean } | { ok: false; reason: string } {
  const deps = ctx.trust ?? realTrust;
  const root = resolve(ctx.cfg.workDir);
  const target = resolve(join(root, dir));
  if (dirname(target) !== root) return { ok: false, reason: '作業フォルダの直下ではない' };
  if (!deps.exists(target)) return { ok: false, reason: `${dir} が無い` };
  const path = ctx.cfg.claudeJsonFile;
  const edit = applyProjectTrust(deps.read(path), deps.realpath(target));
  if (!edit.ok) return { ok: false, reason: edit.reason };
  if (edit.changed) {
    try {
      deps.write(path, edit.text);
    } catch {
      return { ok: false, reason: '~/.claude.json を書けなかった' };
    }
    ctx.log.info(`フォルダを信頼済みにした（指示 ${commandId} による）`, { dir });
  }
  return { ok: true, changed: edit.changed };
}

export async function rcStartDir(
  ctx: ActionContext,
  dir: unknown,
  commandId: string,
): Promise<ActionOutcome> {
  if (!isRcDirName(dir)) return failOutcome('dir の形が不正');
  const m = ctx.rcDirs;
  if (!m) return failOutcome('この環境では追加 RC を扱えない');
  const t = ensureTrusted(ctx, dir, commandId);
  if (!t.ok) return failOutcome(`起動できない: ${t.reason}`);
  const r = m.start(dir, commandId);
  if (!r.ok) return failOutcome(`起動できない: ${r.reason}`);
  ctx.state.rc_dirs = m.desired();
  ctx.saveState();
  if (r.already)
    return okOutcome(`${dir} は既に動いている${t.changed ? '（信頼を記録した）' : ''}`);
  return okOutcome(
    t.changed
      ? `${dir} を信頼済みにして Remote Control を起動した`
      : `${dir} で Remote Control を起動した`,
  );
}

export async function rcStopDir(ctx: ActionContext, dir: unknown): Promise<ActionOutcome> {
  if (!isRcDirName(dir)) return failOutcome('dir の形が不正');
  const m = ctx.rcDirs;
  if (!m) return failOutcome('この環境では追加 RC を扱えない');
  const r = m.stop(dir);
  if (!r.ok) return failOutcome(`停止できない: ${r.reason}`);
  ctx.state.rc_dirs = m.desired();
  ctx.saveState();
  return okOutcome(
    r.wasRunning ? `${dir} の Remote Control を止めた` : `${dir} は動いていなかった`,
  );
}

/** rc_mkdir：作業フォルダ直下にフォルダを作る。start なら続けて信頼を記録し、rc_start_dir と同じ起動をする */

export interface MkdirDeps {
  exists: (p: string) => boolean;
  mkdir: (p: string) => void;
}
const realFs: MkdirDeps = {
  exists: existsSync,
  mkdir: (p) => mkdirSync(p, { mode: 0o755 }),
};

export async function rcMkdir(
  ctx: ActionContext,
  dir: unknown,
  start: boolean,
  commandId: string,
  deps: MkdirDeps = realFs,
): Promise<ActionOutcome> {
  if (!isRcDirName(dir)) return failOutcome('dir の形が不正');
  const root = resolve(ctx.cfg.workDir);
  const target = resolve(join(root, dir));
  // isRcDirName でパス区切りは弾いているが、作業フォルダの直下であることを二重に確かめる
  if (dirname(target) !== root) return failOutcome('作業フォルダの直下ではない');
  if (!deps.exists(root)) return failOutcome('作業フォルダが無い');
  if (deps.exists(target)) return failOutcome(`${dir} は既にある`);
  try {
    deps.mkdir(target);
  } catch {
    return failOutcome(`${dir} を作れなかった`);
  }
  if (!start) return okOutcome(`${dir} を作成した`);
  const m = ctx.rcDirs;
  if (!m) return failOutcome(`${dir} を作成したが、この環境では追加 RC を扱えない`);
  const t = ensureTrusted(ctx, dir, commandId);
  if (!t.ok) return failOutcome(`${dir} を作成したが起動できない: ${t.reason}`);
  const r = m.start(dir, commandId);
  if (!r.ok) return failOutcome(`${dir} を作成したが起動できない: ${r.reason}`);
  ctx.state.rc_dirs = m.desired();
  ctx.saveState();
  return okOutcome(`${dir} を作成し、信頼済みにして Remote Control を起動した`);
}
