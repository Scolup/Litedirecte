// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import { assertAlive, ctxNow, getConfig, isOnline, setToken, type EdContext } from './context';
import {
  DEFAULT_MAX_RETRIES,
  DEFAULT_RETRY_DELAY_MS,
  DEFAULT_TIMEOUT_MS,
  SESSION_EXPIRED_CODES,
  buildApiUrl,
  appendQueryParams,
  buildHeaders,
  buildRequestBody,
  parseJsonResponse,
  sendRequest,
  type HttpMethod,
  type QueryParams,
} from './http';
import {
  EdApiError,
  EdAuthError,
  EdNetworkError,
  EdOfflineError,
  EdRateLimitError,
  EdServerError,
  EdTimeoutError,
  EdUnsupportedModuleError,
  EdValidationError,
  getFriendlyErrorMessage,
} from './errors';
import { transform } from './transform';
import { isFormData } from './env';
import { getMockData } from './mock';
import { sessionEndedError } from './request';

/** Internal request options. Not part of the public API: public option types list only what they support. */
export interface FetchOptions {
  method?: HttpMethod;
  body?: unknown;
  params?: QueryParams;
  skipAuth?: boolean;
  useGtk?: string;
  twofaToken?: string;
  xToken?: string;
  isDownload?: boolean;
  skipQueue?: boolean;
  queued?: boolean;
  returnEnvelope?: boolean;
  mockMode?: boolean;
  /** Internal: background requests never prompt for credentials. */
  background?: boolean;
}

interface PreparedRequest {
  url: URL;
  method: HttpMethod;
  headers: Record<string, string>;
  body?: string | FormData;
}

const TOKEN_PERSIST_THROTTLE_MS = 30_000;
const RATE_WINDOW_MS = 60_000;
/** Late 521s reuse a just-finished refresh instead of starting a new one. */
const REFRESH_REUSE_MS = 5000;

/** A mutation is an explicitly queued request or any endpoint whose verbe is not `get`. */
export function isMutationRequest(endpoint: string, options: FetchOptions): boolean {
  if (options.queued === true) return true;
  const match = endpoint.match(/[?&]verbe=([^&]*)/);
  if (match) return match[1] !== 'get';
  return (options.method ?? 'POST') !== 'GET';
}

function persistRotatedToken(ctx: EdContext, token: string): void {
  const now = ctxNow(ctx);
  if (now - ctx.lastTokenPersistAt < TOKEN_PERSIST_THROTTLE_MS) return;
  ctx.lastTokenPersistAt = now;
  try {
    const storage = getConfig(ctx).storage;
    Promise.resolve(storage?.set('ed_tk', token)).catch(() => {});
  } catch {}
}

/** Update memory and (throttled) storage with a server-rotated token. */
export function applyRotatedToken(ctx: EdContext, token: string): void {
  setToken(ctx, token);
  persistRotatedToken(ctx, token);
}

function runLimiter<T>(ctx: EdContext, fn: () => Promise<T>): Promise<T> {
  const limiter = ctx.limiter;
  return new Promise<T>((resolve, reject) => {
    limiter.queue.push(() => {
      fn()
        .then(resolve, reject)
        .finally(() => {
          limiter.active--;
          pumpLimiter(limiter);
        });
    });
    pumpLimiter(limiter);
  });
}

function pumpLimiter(limiter: EdContext['limiter']): void {
  while (limiter.active < limiter.concurrency && limiter.queue.length > 0) {
    limiter.active++;
    limiter.queue.shift()!();
  }
}

function pruneRateHits(ctx: EdContext): void {
  const cutoff = ctxNow(ctx) - RATE_WINDOW_MS;
  const hits = ctx.rate.hits;
  while (hits.length > 0 && hits[0] <= cutoff) hits.shift();
}

/** Record a hit without waiting (login, 2FA and token-refresh requests count but never wait). */
export function recordRateHit(ctx: EdContext): void {
  const limit = ctx.config.maxRequestsPerMinute ?? 100;
  if (limit <= 0 || ctx.destroyed) return;
  pruneRateHits(ctx);
  ctx.rate.hits.push(ctxNow(ctx));
}

/** Wait for a rate slot (FIFO). Never rejects except when the instance is destroyed. */
function acquireRateSlot(ctx: EdContext): Promise<void> {
  const limit = ctx.config.maxRequestsPerMinute ?? 100;
  if (limit <= 0) return Promise.resolve();
  pruneRateHits(ctx);
  if (ctx.rate.hits.length < limit) {
    ctx.rate.hits.push(ctxNow(ctx));
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    ctx.rate.waiters.push({ resolve, reject });
    scheduleRateTimer(ctx);
  });
}

function scheduleRateTimer(ctx: EdContext): void {
  if (ctx.rate.timer !== undefined || ctx.rate.waiters.length === 0 || ctx.destroyed) return;
  const limit = ctx.config.maxRequestsPerMinute ?? 100;
  pruneRateHits(ctx);
  if (ctx.rate.hits.length < limit) {
    drainRateWaiters(ctx);
    return;
  }
  const waitMs = Math.max(ctx.rate.hits[0] + RATE_WINDOW_MS - ctxNow(ctx), 0);
  const timer = setTimeout(() => onRateTimer(ctx), waitMs);
  try {
    (timer as unknown as { unref?: () => void })?.unref?.();
  } catch {}
  ctx.rate.timer = timer;
}

function onRateTimer(ctx: EdContext): void {
  ctx.rate.timer = undefined;
  if (ctx.destroyed) return;
  drainRateWaiters(ctx);
  if (ctx.rate.waiters.length > 0) scheduleRateTimer(ctx);
}

function drainRateWaiters(ctx: EdContext): void {
  const limit = ctx.config.maxRequestsPerMinute ?? 100;
  pruneRateHits(ctx);
  while (ctx.rate.waiters.length > 0 && ctx.rate.hits.length < limit) {
    ctx.rate.hits.push(ctxNow(ctx));
    ctx.rate.waiters.shift()!.resolve();
  }
}

function clearRateLimiter(ctx: EdContext, error?: unknown): void {
  if (ctx.rate.timer !== undefined) {
    try {
      clearTimeout(ctx.rate.timer);
    } catch {}
    ctx.rate.timer = undefined;
  }
  if (error !== undefined) {
    const waiters = ctx.rate.waiters;
    ctx.rate.waiters = [];
    for (const waiter of waiters) waiter.reject(error);
  }
}

function throwIfEnded(ctx: EdContext, startGen: number): void {
  if (ctx.destroyed) throw new EdValidationError('Instance destroyed', 'INVALID_ARGUMENT');
  if (ctx.sessionGen !== startGen) {
    throw sessionEndedError();
  }
}

export async function edFetch<T>(
  ctx: EdContext,
  endpoint: string,
  options: FetchOptions = {},
): Promise<T> {
  assertAlive(ctx);
  const startGen = ctx.sessionGen;
  const config = getConfig(ctx);
  const mutation = isMutationRequest(endpoint, options);
  const background = options.background === true || ctx.backgroundDepth > 0;
  const accountIdBefore = ctx.account?.id;

  const run = async (attempts = 0): Promise<T> => {
    throwIfEnded(ctx, startGen);
    let data: any;
    let headerToken: string | null = null;
    let statusCode = 200;
    let sentToken: string | undefined;

    if (options.mockMode) {
      if (options.isDownload) {
        return new Response('mock-download-content') as unknown as T;
      }
      data = {
        code: 200,
        message: '',
        token: 'mock-token',
        host: 'MOCK',
        data: getMockData(endpoint, options),
      };
    } else {
      if (!isOnline(ctx)) {
        throw new EdOfflineError('No network connection', 'OFFLINE');
      }
      await acquireRateSlot(ctx);
      throwIfEnded(ctx, startGen);
      const req = prepareRequest(ctx, endpoint, options);
      sentToken = ctx.token;
      const response = await sendRequest({
        url: req.url.toString(),
        method: req.method,
        headers: req.headers,
        body: req.body,
        timeoutMs: config.timeout ?? DEFAULT_TIMEOUT_MS,
      });

      throwIfEnded(ctx, startGen);

      if (options.isDownload) {
        if (!response.ok) {
          if (response.status >= 500) {
            throw new EdServerError(
              `Server error: ${response.status}`,
              'SERVER_ERROR',
              response.status,
            );
          }
          throw new EdApiError(
            `Request failed: ${response.status}`,
            String(response.status),
            response.status,
          );
        }
        return response as T;
      }

      statusCode = response.status;
      headerToken = response.headers.get('x-token');
      data = await parseJsonResponse(response);
    }

    throwIfEnded(ctx, startGen);

    if (!options.mockMode && headerToken) {
      if (startGen === ctx.sessionGen) {
        applyRotatedToken(ctx, headerToken);
        data.token = headerToken;
      }
    }

    if (SESSION_EXPIRED_CODES.includes(data.code)) {
      if (attempts >= 1) {
        const rawMsg = data.message || 'Session expired after refresh attempt';
        const friendlyMsg = getFriendlyErrorMessage(String(data.code), rawMsg);
        throw new EdAuthError(friendlyMsg, String(data.code), statusCode, data);
      }

      if (!options.mockMode && sentToken !== undefined && ctx.token !== sentToken) {
        return run(attempts + 1);
      }

      if (!options.mockMode && sentToken !== undefined && ctx.token === sentToken) {
        const doneAt = ctx.lastRefreshDoneAt;
        if (doneAt > 0 && ctxNow(ctx) - doneAt < REFRESH_REUSE_MS) {
          if (ctx.lastRefreshOk) return run(attempts + 1);
          const rawMsg = data.message || 'Session expired';
          const friendlyMsg = getFriendlyErrorMessage(String(data.code), rawMsg);
          throw new EdAuthError(friendlyMsg, String(data.code), statusCode, data);
        }
      }

      const refreshed = await ensureRefreshed(ctx, background);
      throwIfEnded(ctx, startGen);
      if (accountIdBefore !== undefined && ctx.account && ctx.account.id !== accountIdBefore) {
        const rawMsg = data.message || 'Session expired';
        const friendlyMsg = getFriendlyErrorMessage(String(data.code), rawMsg);
        throw new EdAuthError(friendlyMsg, String(data.code), statusCode, data);
      }
      if (!refreshed) {
        const rawMsg = data.message || 'Session expired';
        const friendlyMsg = getFriendlyErrorMessage(String(data.code), rawMsg);
        throw new EdAuthError(friendlyMsg, String(data.code), statusCode, data);
      }

      return run(attempts + 1);
    }

    if (data.code === 250) {
      const rawMsg = data.message || 'Two-factor authentication required';
      const friendlyMsg = getFriendlyErrorMessage('250', rawMsg);
      throw new EdAuthError(friendlyMsg, '2FA_REQUIRED', statusCode, data);
    }

    if (data.code !== 200) {
      const rawMsg = data.message || 'API error';
      const friendlyMsg = getFriendlyErrorMessage(String(data.code), rawMsg);
      throw new EdApiError(friendlyMsg, String(data.code), statusCode, data);
    }

    if (!options.mockMode && data.token) {
      if (startGen === ctx.sessionGen) {
        applyRotatedToken(ctx, data.token);
      }
    }

    if (options.returnEnvelope) {
      return data as unknown as T;
    }

    return transform(data.data);
  };

  const retries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryDelay = config.retryDelay ?? DEFAULT_RETRY_DELAY_MS;

  const execute = async () => {
    let currentAttempt = 0;
    let delay = retryDelay;

    while (true) {
      try {
        return await run(0);
      } catch (error: any) {
        if (ctx.destroyed) throw error;
        if (error instanceof EdAuthError && error.code === 'SESSION_ENDED') throw error;
        if (ctx.sessionGen !== startGen) {
          throw sessionEndedError();
        }
        currentAttempt++;
        const isRetryable =
          error instanceof EdUnsupportedModuleError || error instanceof EdOfflineError
            ? false
            : mutation
              ? error instanceof EdRateLimitError
              : !(error instanceof EdAuthError || error instanceof EdApiError);
        if (currentAttempt > retries || !isRetryable) {
          queueOnceOnFinalFailure(ctx, endpoint, options, error);
          throw error;
        }
        if (config.onError) {
          await config.onError(error);
        }
        const waitMs =
          error instanceof EdRateLimitError && error.retryAfterMs !== undefined
            ? error.retryAfterMs
            : Math.min(delay * (0.8 + Math.random() * 0.4), 8000);
        await new Promise((r) => setTimeout(r, waitMs));
        delay = Math.min(delay * 2, 8000);
      }
    }
  };

  return runLimiter(ctx, execute);
}

function queueOnceOnFinalFailure(
  ctx: EdContext,
  endpoint: string,
  options: FetchOptions,
  error: unknown,
): void {
  const config = getConfig(ctx);
  if (!config.offlineQueue || options.skipQueue || options.skipAuth || options.queued !== true) {
    return;
  }
  if (!(error instanceof EdNetworkError) || error instanceof EdTimeoutError) return;
  void pushOffline(ctx, endpoint, options as Record<string, unknown>);
}

async function pushOffline(
  ctx: EdContext,
  endpoint: string,
  options: Record<string, unknown>,
): Promise<void> {
  const { pushToQueue } = await import('./queue');
  await pushToQueue(ctx, endpoint, options);
}

function prepareRequest(ctx: EdContext, endpoint: string, options: FetchOptions): PreparedRequest {
  const url = buildApiUrl(ctx, endpoint);
  appendQueryParams(url, options.params);
  const body = buildRequestBody(endpoint, options.body);
  const headers = buildHeaders(ctx, {
    skipAuth: options.skipAuth,
    useGtk: options.useGtk,
    twofaToken: options.twofaToken,
    xToken: options.xToken,
  });
  // Téléversement : pas de Content-Type forcé, le runtime pose
  // multipart/form-data + boundary lui-même.
  if (isFormData(body)) delete headers['Content-Type'];
  return {
    url,
    method: options.method ?? 'POST',
    headers,
    body,
  };
}

async function refreshSession(ctx: EdContext, interactive: boolean): Promise<string | undefined> {
  try {
    const { refreshToken } = await import('../auth/index');
    const token = await refreshToken(ctx, { interactive });
    setToken(ctx, token);
    return token;
  } catch (error) {
    if (error instanceof EdNetworkError) throw error;
    return undefined;
  }
}

function trackRefresh(
  ctx: EdContext,
  task: Promise<string | undefined>,
): Promise<string | undefined> {
  return task.finally(() => {
    ctx.refreshPromise = null;
    ctx.refreshSilent = undefined;
  });
}

function markRefreshDone(ctx: EdContext, ok: boolean): void {
  ctx.lastRefreshDoneAt = ctxNow(ctx);
  ctx.lastRefreshOk = ok;
}

/** Single-flight refresh. Background: silent only. Foreground: silent, then one interactive retry. */
async function ensureRefreshed(ctx: EdContext, background: boolean): Promise<string | undefined> {
  if (!ctx.refreshPromise) {
    const interactive = !background;
    ctx.refreshSilent = !interactive;
    ctx.refreshPromise = trackRefresh(ctx, refreshSession(ctx, interactive));
  }
  let result: string | undefined;
  try {
    result = await ctx.refreshPromise;
  } catch (error) {
    if (error instanceof EdNetworkError) throw error;
    throw error;
  }
  markRefreshDone(ctx, result !== undefined);
  if (result === undefined && !background) {
    if (!ctx.refreshPromise) {
      ctx.refreshSilent = false;
      ctx.refreshPromise = trackRefresh(ctx, refreshSession(ctx, true));
    } else if (ctx.refreshSilent) {
      try {
        await ctx.refreshPromise;
      } catch (error) {
        if (error instanceof EdNetworkError) throw error;
      }
      if (!ctx.refreshPromise) {
        ctx.refreshSilent = false;
        ctx.refreshPromise = trackRefresh(ctx, refreshSession(ctx, true));
      }
    } else {
      return result;
    }
    try {
      result = await ctx.refreshPromise;
    } catch (error) {
      if (error instanceof EdNetworkError) throw error;
      return undefined;
    }
    markRefreshDone(ctx, result !== undefined);
  }
  return result;
}

/** Reject or drop queued rate-limited requests (called by `destroy()`). */
export function destroyRateLimiter(ctx: EdContext, error: unknown): void {
  clearRateLimiter(ctx, error);
}
