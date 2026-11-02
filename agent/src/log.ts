/**
 * ログは stdout / stderr に 1 行ずつ出す（ローテーションは newsyslog が担当）。
 * 設定値・トークン・パス・ログ本文は出さない（CLAUDE.md 3）。呼び出し側が fields に入れる値は
 * 状態名・回数・経過秒・終了コードのような短い値に限る。
 */

export type LogLevel = 'info' | 'warn' | 'error';
export type LogFields = Record<string, string | number | boolean | null | undefined>;

export function formatLogLine(
  level: LogLevel,
  message: string,
  fields?: LogFields,
  at: Date = new Date(),
): string {
  const kv = fields
    ? Object.entries(fields)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(' ')
    : '';
  return `${at.toISOString()} ${level.toUpperCase()} ${message}${kv ? ' ' + kv : ''}`;
}

export interface Logger {
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

export const log: Logger = {
  info(message, fields) {
    process.stdout.write(formatLogLine('info', message, fields) + '\n');
  },
  warn(message, fields) {
    console.warn(formatLogLine('warn', message, fields));
  },
  error(message, fields) {
    console.error(formatLogLine('error', message, fields));
  },
};

/** テストなどで出力を捨てたいときに使う */
export const silentLogger: Logger = { info() {}, warn() {}, error() {} };
