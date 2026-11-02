import { afterEach, describe, expect, it } from 'vitest';
import { buildClaudeStatus } from '../src/collect/claude.js';
import { parseSessionsFromLog, listSessions } from '../src/collect/sessions.js';
import {
  BUSY_CPU_PCT,
  BUSY_LOG_ACTIVITY_MS,
  classifyRcLog,
  defaultBusyJudge,
  isBusy,
  setBusyJudge,
} from '../src/collect/rclog.js';

describe('Remote Control のログ判定（実機の [bridge:*] 行。docs/verify.md C-3）', () => {
  it('[bridge:session] / [bridge:title] / [bridge:token] は connected', () => {
    expect(classifyRcLog('[bridge:session] sessionId=abc123 pid=4321\n')).toBe('connected');
    expect(classifyRcLog('[bridge:title] server title for session_abc: 作業中のタイトル\n')).toBe(
      'connected',
    );
    expect(classifyRcLog('[bridge:token] Scheduled token refresh in 3500s\n')).toBe('connected');
    // 起動時の行が流れたあとも、heartbeat の成功や ws の受信があれば connected
    expect(
      classifyRcLog(
        '[bridge:api] POST .../work/cse_x/heartbeat -> 200 lease_extended=true state=active\n',
      ),
    ).toBe('connected');
    expect(classifyRcLog('[bridge:ws] sessionId=[REDACTED] <<< {"type":"system"}\n')).toBe(
      'connected',
    );
  });

  it('最後に当たった行で決まる', () => {
    expect(classifyRcLog('a\n[info] remote control connected\n')).toBe('connected');
    expect(classifyRcLog('remote control connected\nwebsocket: reconnecting in 5s\n')).toBe(
      'reconnecting',
    );
    expect(classifyRcLog('reconnecting\nconnected\n')).toBe('connected');
  });
  it('ログイン切れ', () => {
    expect(classifyRcLog('connected\nerror: Not logged in. Please run /login\n')).toBe(
      'login_required',
    );
  });
  it('何も当たらなければ unknown（推測で connected にしない）', () => {
    expect(classifyRcLog('')).toBe('unknown');
    expect(classifyRcLog('starting up\nloaded settings\n')).toBe('unknown');
  });
});

describe('ClaudeStatus の組み立て', () => {
  it('プロセスが止まっているのに connected は unknown にする', () => {
    const s = buildClaudeStatus({
      launchd: { state: 'stopped' },
      logState: 'connected',
      version: '2.1.50',
      lastRestart: 1000,
    });
    expect(s).toEqual({
      state: 'stopped',
      rc_state: 'unknown',
      version: '2.1.50',
      channel: 'stable',
      last_restart: 1000,
    });
  });
  it('無い値は入れない（undefined を送らない）', () => {
    const s = buildClaudeStatus({
      launchd: { state: 'running', pid: 1 },
      logState: 'connected',
      version: undefined,
      lastRestart: undefined,
    });
    expect(Object.keys(s).sort()).toEqual(['channel', 'rc_state', 'state']);
  });
});

describe('作業中判定（差し替え可能）', () => {
  afterEach(() => setBusyJudge(defaultBusyJudge));
  it('既定：直近のログ活動か CPU', () => {
    expect(isBusy({ logAgeMs: BUSY_LOG_ACTIVITY_MS - 1, cpuPct: 0, rcState: 'connected' })).toBe(
      true,
    );
    expect(
      isBusy({
        logAgeMs: BUSY_LOG_ACTIVITY_MS + 1,
        cpuPct: BUSY_CPU_PCT + 1,
        rcState: 'connected',
      }),
    ).toBe(true);
    expect(isBusy({ logAgeMs: null, cpuPct: null, rcState: 'connected' })).toBe(false);
  });
  it('差し替えられる', () => {
    setBusyJudge(() => true);
    expect(isBusy({ logAgeMs: null, cpuPct: null, rcState: 'unknown' })).toBe(true);
  });
});

describe('セッションをログから拾う（docs/verify.md C-2）', () => {
  const log = [
    '2026-10-31T14:50:00Z [bridge:session] sessionId=cse_01HXYZabc pid=4321',
    '2026-10-31T14:50:01Z [bridge:session] Child args: remote-control --session-id cse_01HXYZabc --foo',
    '2026-10-31T14:50:05Z [bridge:title] server title for session_7f3a: ' + 'タ'.repeat(70),
    '2026-10-31T14:51:00Z [bridge:token] Scheduled token refresh in 3500s',
    '2026-10-31T15:00:00Z [bridge:session] sessionId=[REDACTED] pid=9',
    '2026-10-31T15:10:00Z [bridge:session] sessionId=cse_02NEWER pid=5000',
  ].join('\n');
  it('ID を 3 か所から取り、新しいものが先。タイトルは 60 文字。REDACTED は捨てる', () => {
    const s = parseSessionsFromLog(log);
    expect(s.map((x) => x.id)).toEqual(['cse_02NEWER', 'session_7f3a', 'cse_01HXYZabc']);
    expect([...(s[1]?.title ?? '')]).toHaveLength(60);
    expect(s[2]).toEqual({ id: 'cse_01HXYZabc' });
    expect(parseSessionsFromLog('')).toEqual([]);
  });
  it('複数ログをまとめ、重複は先勝ち', async () => {
    const logs: Record<string, string> = {
      a: '[bridge:session] sessionId=cse_A pid=1\n[bridge:title] server title for cse_A: one',
      b: '[bridge:session] sessionId=cse_A pid=2\n[bridge:session] sessionId=cse_B pid=3',
    };
    const s = await listSessions(['a', 'b'], (p) => logs[p] ?? '');
    expect(s).toEqual([{ id: 'cse_A', title: 'one' }, { id: 'cse_B' }]);
  });
});
