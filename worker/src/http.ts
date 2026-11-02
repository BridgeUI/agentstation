/** HTTP の小道具。画面向け API はキャッシュしない（docs/spec.md 4.1）。 */

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

/** POST は JSON 必須（CSRF 対策の一つ）。形の検証は呼び出し側で行う。 */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const ct = request.headers.get('content-type') ?? '';
  if (!ct.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'Content-Type は application/json にする');
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, 'JSON として読めない');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HttpError(400, 'JSON オブジェクトを送る');
  }
  return body as Record<string, unknown>;
}

export function str(o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key];
  return typeof v === 'string' ? v : undefined;
}

export function num(o: Record<string, unknown>, key: string): number | undefined {
  const v = o[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export function obj(o: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const v = o[key];
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}
