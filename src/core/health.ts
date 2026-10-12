// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import { assertAlive, getConfig, type EdContext } from './context';
import { buildApiUrl, buildHeaders, sendRequest, parseJsonResponse } from './http';
import { EdAuthError } from './errors';
import { safeSetInterval, safeClearInterval } from './env';

const TOKEN_CHECK_ENDPOINT = '/rdt/sondages.awp?verbe=get';
const TOKEN_CHECK_BODY = 'data=%7B%7D';
const KEEPALIVE_INTERVAL_MS = 45 * 60 * 1000;

export async function checkTokenHealth(ctx: EdContext): Promise<boolean> {
  assertAlive(ctx);
  const token = ctx.token;
  if (!token) return false;

  try {
    const url = buildApiUrl(ctx, TOKEN_CHECK_ENDPOINT);
    const headers = buildHeaders(ctx);
    const response = await sendRequest({
      url: url.toString(),
      method: 'POST',
      headers,
      body: TOKEN_CHECK_BODY,
    });
    const data = await parseJsonResponse(response);
    const rotated = response.headers.get('x-token');
    if (rotated) {
      const { applyRotatedToken, recordRateHit } = await import('./fetch');
      recordRateHit(ctx);
      applyRotatedToken(ctx, rotated);
    }
    return data.code === 200;
  } catch {
    return false;
  }
}

export function startTokenKeepalive(ctx: EdContext): void {
  stopTokenKeepalive(ctx);
  ctx.keepaliveTimer = safeSetInterval(() => keepaliveTick(ctx), KEEPALIVE_INTERVAL_MS);
}

async function keepaliveTick(ctx: EdContext): Promise<void> {
  if (ctx.destroyed) return;
  const valid = await checkTokenHealth(ctx);
  if (ctx.destroyed) return;
  if (!valid) {
    try {
      const { refreshToken } = await import('../auth/index');
      await refreshToken(ctx);
    } catch (error) {
      if (!(error instanceof EdAuthError)) {
        try {
          await getConfig(ctx).onError?.(error);
        } catch {}
        return;
      }
      stopTokenKeepalive(ctx);
      try {
        await getConfig(ctx).onError?.(error);
      } catch {}
    }
  }
}

export function stopTokenKeepalive(ctx: EdContext): void {
  safeClearInterval(ctx.keepaliveTimer ?? undefined);
  ctx.keepaliveTimer = null;
}

export function isKeepaliveActive(ctx: EdContext): boolean {
  return ctx.keepaliveTimer != null;
}

/** Test hook: run one keepalive tick for the given instance. */
export function __keepaliveTickForTests(ctx: EdContext): Promise<void> {
  return keepaliveTick(ctx);
}
