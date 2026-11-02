import { dirname } from 'node:path';
import type { Command, Heartbeat, PeerSummary, SetupCheck, VmEnv } from '@macmini/shared';
import type { ActionContext } from './actions/context.js';
import { decideFull, nextDelay } from './cadence.js';
import { executeCommand } from './actions/index.js';
import { rcRestart } from './actions/rc.js';
import { prepareMainRc, realTrust } from './claudetrust.js';
import { collectClaude, collectCodex } from './collect/claude.js';
import { collectGuest } from './collect/guest.js';
import { buildHeartbeat } from './collect/heartbeat.js';
import { collectHost, CpuSampler } from './collect/host.js';
import { collectRcDirs } from './collect/rcdirs.js';
import { VmProcessResolver } from './collect/vmproc.js';
import { classifyRcLog, logAgeMs, readTail, type BusyMaterials } from './collect/rclog.js';
import { listSessions } from './collect/sessions.js';
import { collectSetup } from './collect/setup.js';
import { parsePs, processCpuPct, type PsRow } from './collect/usage.js';
import type { AgentConfig } from './config.js';
import { realRunner, sleep, type Runner } from './exec.js';
import type { Logger } from './log.js';
import { runMaintenanceTask } from './maintenance/run.js';
import { dueTasks } from './maintenance/schedule.js';
import { RcDirManager } from './rcdirs/manager.js';
import { readRcSettings } from './rcsettings.js';
import { ApiClient } from './send/client.js';
import { loadState, saveState, type AgentState } from './state.js';
import { AGENT_VERSION } from './version.js';
import { decideWatchdog } from './watchdog.js';

/**
 * 常駐の本体（docs/spec.md 3.6）。
 * 60 秒ごとに「集める → 送る → 受け取った指示を直列に実行」を繰り返す。画面が見られている・指示が進行中のあいだは
 * サーバーの指示（poll_ms）で 5 秒ごとに見に行く（軽い問い合わせ。cadence.ts）。指示が終わった直後は報告を前倒しする。
 * 操作（指示・夜間メンテナンス・自動の立て直し）は 1 本の直列キューで動かし、同じ環境で同時に 1 件にする。
 * ハートビートはキューとは別に動くので、長い操作の間も報告は止まらない。
 */
const SETUP_REFRESH_MS = 5 * 60 * 1000;

export interface LoopDeps {
  cfg: AgentConfig;
  log: Logger;
  run?: Runner;
  api?: ApiClient;
}

export class AgentLoop {
  private readonly cfg: AgentConfig;
  private readonly log: Logger;
  private readonly run: Runner;
  private readonly api: ApiClient;
  private readonly state: AgentState;
  private readonly startedAt = Date.now();
  private readonly sampler = new CpuSampler();
  private readonly vmResolver = new VmProcessResolver();
  private readonly rcDirs: RcDirManager;
  private timer: NodeJS.Timeout | null = null;
  /** 次の tick までの間隔。サーバーの poll_ms で決まる（cadence.ts） */
  private nextMs: number;
  private lastFullAt = 0;
  private lastCommandAt = 0;
  private stopping = false;
  private ticking = false;
  private queue: Promise<void> = Promise.resolve();
  private queuedIds = new Set<string>();
  private peers: Partial<Record<VmEnv, PeerSummary>> = {};
  private reconnectingSince: number | null = null;
  private lastPs: PsRow[] = [];
  private lastClaudePid: number | undefined;
  private lastRcState: BusyMaterials['rcState'] = 'unknown';
  /** 基礎設定のチェックは重いので 5 分に 1 回だけ更新し、それ以外はキャッシュを再送する */
  private setupCache: { at: number; checks: SetupCheck[] } | null = null;

  constructor(deps: LoopDeps) {
    this.cfg = deps.cfg;
    this.log = deps.log;
    this.run = deps.run ?? realRunner;
    this.nextMs = deps.cfg.intervalMs;
    this.api = deps.api ?? new ApiClient(deps.cfg, deps.log);
    this.state = loadState(deps.cfg.stateFile);
    this.rcDirs = new RcDirManager({
      workDir: deps.cfg.workDir,
      claudePath: deps.cfg.claudePath,
      logDir: dirname(deps.cfg.rcDebugLog),
      log: deps.log,
      permissionMode: () => readRcSettings(deps.cfg.rcSettingsFile).permission_mode,
    });
  }

  start(): void {
    this.log.info('macmini-agent 起動', {
      version: AGENT_VERSION,
      env: this.cfg.env,
      interval_ms: this.cfg.intervalMs,
    });
    // メインの RC が端末なしで起動できるよう、作業フォルダの信頼と Remote Control の同意を記録する（claudetrust.ts）
    this.prepareMainRc();
    // 前回まで希望していた追加 RC を戻す（state.json）
    this.rcDirs.restore(this.state.rc_dirs);
    void this.tick();
  }

  private prepareMainRc(): void {
    const r = prepareMainRc(realTrust, this.cfg.claudeJsonFile, this.cfg.workDir);
    if (!r.ok) {
      this.log.error('作業フォルダの信頼・Remote Control の同意を記録できない', {
        reason: r.reason,
      });
    } else if (r.trusted || r.consented) {
      this.log.info('Remote Control の初回の答えを記録した', {
        trusted: r.trusted,
        consented: r.consented,
      });
    }
  }

  /** SIGTERM：次の tick を止め、実行中の操作が終わるのを待つ */
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    await this.queue;
    this.rcDirs.shutdown();
    this.log.info('macmini-agent 停止');
  }

  private schedule(): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => void this.tick(), this.nextMs);
  }

  private async tick(): Promise<void> {
    if (this.ticking || this.stopping) return;
    this.ticking = true;
    try {
      await this.tickOnce();
    } catch (e) {
      this.log.error('tick で例外', { reason: (e as Error).name });
    } finally {
      this.ticking = false;
      this.schedule();
    }
  }

  /** 指示が終わった直後に報告を 1 回前倒しする（結果と新しい状態を早く見せる） */
  private kick(): void {
    if (this.stopping || this.ticking) return;
    if (this.timer) clearTimeout(this.timer);
    void this.tick();
  }

  private async tickOnce(): Promise<void> {
    const now = Date.now();
    const full = decideFull({
      now,
      lastFullAt: this.lastFullAt,
      lastCommandAt: this.lastCommandAt,
      intervalMs: this.cfg.intervalMs,
    });
    if (!full) {
      // 軽い問い合わせ：状態は送らず、未実行の指示と次の間隔だけ受け取る
      const res = await this.api.postPoll(this.cfg.env);
      this.nextMs = nextDelay(res?.poll_ms, this.cfg.intervalMs);
      if (res) this.enqueueCommands(res.commands);
      return;
    }
    this.lastFullAt = now;
    const claude = await collectClaude(this.run, this.cfg, this.state.rc_last_restart);
    // Remote Control の権限モード（rc.json）。画面に出す（13章 #18）
    claude.status.rc_permission_mode = readRcSettings(this.cfg.rcSettingsFile).permission_mode;
    const codex = await collectCodex(this.run, this.cfg);
    const sessions = await listSessions([this.cfg.rcDebugLog, ...this.rcDirs.logPaths()]);
    const rcDirs = collectRcDirs(
      this.cfg.workDir,
      this.rcDirs.snapshot(
        (dir) => classifyRcLog(readTail(this.rcDirs.logPathFor(dir))) === 'connected',
      ),
    );
    this.lastClaudePid = claude.launchd.pid;
    this.lastRcState = claude.status.rc_state;
    const setup = await this.setupChecks(now);

    let heartbeat: Heartbeat;
    if (this.cfg.env === 'host') {
      const h = await collectHost(this.run, this.cfg, this.sampler, this.vmResolver);
      this.lastPs = h.ps;
      heartbeat = buildHeartbeat({
        env: 'host',
        agentVersion: AGENT_VERSION,
        agentStartedAt: this.startedAt,
        sentAt: now,
        claude: claude.status,
        codex,
        sessions,
        ...(this.state.maintenance ? { maintenance: this.state.maintenance } : {}),
        setup,
        rcDirs,
        host: h.host,
        vms: h.vms,
      });
    } else {
      const guest = await collectGuest(this.run);
      const ps = await this.run('/bin/ps', ['-axo', 'pid=,ppid=,%cpu=,rss=,command=']);
      this.lastPs = ps.code === 0 ? parsePs(ps.stdout) : [];
      heartbeat = buildHeartbeat({
        env: this.cfg.env,
        agentVersion: AGENT_VERSION,
        agentStartedAt: this.startedAt,
        sentAt: now,
        claude: claude.status,
        codex,
        sessions,
        ...(this.state.maintenance ? { maintenance: this.state.maintenance } : {}),
        setup,
        rcDirs,
        guest,
      });
    }

    this.watchdog(claude.status, now);

    const res = await this.api.postHeartbeat(heartbeat);
    this.nextMs = nextDelay(res?.poll_ms, this.cfg.intervalMs);
    if (res) {
      if (res.peers) this.peers = res.peers;
      this.enqueueCommands(res.commands);
    }

    for (const task of dueTasks(this.cfg.env, now, this.state.maintenance_runs)) {
      this.enqueue(`maintenance:${task.key}`, () =>
        runMaintenanceTask(task, {
          ctx: this.actionContext(),
          busyMaterials: () => this.busyMaterials(),
          peers: () => this.peers,
        }),
      );
    }
  }

  private watchdog(
    claude: { state: 'running' | 'stopped' | 'unknown'; rc_state: BusyMaterials['rcState'] },
    now: number,
  ): void {
    const d = decideWatchdog({
      claude,
      nowMs: now,
      reconnectingSince: this.reconnectingSince,
      autoRestarts: this.state.auto_restarts,
    });
    this.reconnectingSince = d.reconnectingSince;
    const changed = d.autoRestarts.length !== this.state.auto_restarts.length;
    this.state.auto_restarts = d.autoRestarts;
    if (changed) saveState(this.cfg.stateFile, this.state);
    if (d.exhausted) {
      this.log.error('Remote Control の自動の立て直しが上限に達した（1 時間に 3 回）');
    }
    if (d.restart) {
      this.log.warn('再接続待ちが続くため Remote Control を立て直す');
      this.enqueue('watchdog:rc_restart', async () => {
        const r = await rcRestart(this.actionContext());
        this.log[r.ok ? 'info' : 'error']('自動の立て直し', { ok: r.ok });
      });
    }
  }

  private enqueueCommands(commands: Command[]): void {
    for (const cmd of commands) {
      if (this.queuedIds.has(cmd.id)) continue;
      this.queuedIds.add(cmd.id);
      this.log.info('指示を受領', { id: cmd.id, action: cmd.action, target: cmd.env });
      this.enqueue(`command:${cmd.id}`, async () => {
        let sentByAction = false;
        const result = await executeCommand(cmd, this.actionContext(), {
          batch: commands,
          sendResult: async (r) => {
            sentByAction = await this.api.postResult(r);
            return sentByAction;
          },
        });
        if (!sentByAction) {
          const sent = await this.api.postResult(result);
          if (!sent) this.log.error('結果を送れなかった', { id: cmd.id, status: result.status });
        }
        this.log.info('指示を完了', { id: cmd.id, action: cmd.action, status: result.status });
        this.queuedIds.delete(cmd.id);
        this.lastCommandAt = Date.now();
        this.kick();
      });
    }
  }

  private enqueue(name: string, work: () => Promise<void>): void {
    this.queue = this.queue
      .then(work)
      .catch((e: unknown) => this.log.error('操作で例外', { name, reason: (e as Error).name }));
  }

  private actionContext(): ActionContext {
    return {
      cfg: this.cfg,
      run: this.run,
      log: this.log,
      state: this.state,
      saveState: () => saveState(this.cfg.stateFile, this.state),
      now: () => Date.now(),
      sleep,
      readRcLogTail: () => readTail(this.cfg.rcDebugLog),
      rcDirs: this.rcDirs,
    };
  }

  private async setupChecks(now: number): Promise<SetupCheck[]> {
    if (this.setupCache && now - this.setupCache.at < SETUP_REFRESH_MS)
      return this.setupCache.checks;
    try {
      const checks = await collectSetup(this.cfg.env, this.cfg, this.run);
      this.setupCache = { at: now, checks };
      return checks;
    } catch (e) {
      this.log.warn('基礎設定のチェックに失敗', { reason: (e as Error).name });
      return this.setupCache?.checks ?? [];
    }
  }

  private busyMaterials(): BusyMaterials {
    return {
      logAgeMs: logAgeMs(this.cfg.rcDebugLog, Date.now()),
      cpuPct:
        this.lastClaudePid !== undefined ? processCpuPct(this.lastPs, this.lastClaudePid) : null,
      rcState: this.lastRcState,
    };
  }
}
