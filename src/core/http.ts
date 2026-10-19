// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import { getConfig, type EdContext } from './context';
import {
  EdNetworkError,
  EdRateLimitError,
  EdServerError,
  EdParseError,
  EdTimeoutError,
} from './errors';
import { isFormData } from './env';

export const BASE_API_URL = 'https://api.ecoledirecte.com/v3';

export const ED_VERSION = '8.1.0';

export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_RETRY_DELAY_MS = 500;
export const DEFAULT_CONCURRENCY = 3;

export const SESSION_EXPIRED_CODES: readonly number[] = [520, 521, 525];

export const DOWNLOAD_ENDPOINTS = ['telechargement.awp', 'televersement.awp'] as const;

export type QueryParams = Record<string, string | number>;

export function buildApiUrl(ctx: EdContext, endpoint: string): URL {
  const config = getConfig(ctx);
  const baseUrl = config.proxyUrl || BASE_API_URL;
  const fullUrl = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint}`;

  const url = new URL(fullUrl);
  if (!endpoint.startsWith('http') && !url.searchParams.has('v')) {
    url.searchParams.set('v', ED_VERSION);
  }
  return url;
}

export function appendQueryParams(url: URL, params?: QueryParams): void {
  if (!params) return;

  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.append(key, String(value));
  });
}

export function isDownloadEndpoint(endpoint: string): boolean {
  return DOWNLOAD_ENDPOINTS.some((downloadEndpoint) => endpoint.includes(downloadEndpoint));
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export interface RequestHeaderOptions {
  skipAuth?: boolean;
  useGtk?: string;
  twofaToken?: string;
  xToken?: string;
}

export interface SendRequestOptions {
  url: string;
  method: HttpMethod;
  headers: Record<string, string>;
  body?: string | FormData;
  timeoutMs?: number;
}

export function buildHeaders(
  ctx: EdContext,
  options: RequestHeaderOptions = {},
): Record<string, string> {
  const config = getConfig(ctx);

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'X-Requested-With': 'typeof.scolup.litedirecte',
  };

  if (config.proxyUrl) {
    headers['X-Procsy-User-Agent'] = config.userAgent || '';
    headers['X-Procsy-Base-URL'] = BASE_API_URL.replace(/^https?:\/\//, '');
  } else {
    headers['User-Agent'] = config.userAgent || '';
  }

  if (!options.skipAuth) {
    const token = options.xToken || ctx.token;
    if (token) {
      headers['X-Token'] = token;
    }
    const twofaToken = options.twofaToken || ctx.twofaToken;
    if (twofaToken) {
      headers['2FA-Token'] = twofaToken;
    }
  }

  if (options.useGtk) {
    headers['X-GTK'] = options.useGtk;
    headers['Cookie'] = `GTK=${options.useGtk}`;
  }

  return headers;
}

export function buildRequestBody(endpoint: string, body?: unknown): string | FormData | undefined {
  if (!hasBody(body)) return undefined;

  // Téléversement : le FormData part tel quel, le navigateur pose le boundary.
  if (isFormData(body)) return body;

  if (isDownloadEndpoint(endpoint)) {
    return buildFormBody(body);
  }

  return `data=${encodeURIComponent(JSON.stringify(body))}`;
}

export async function sendRequest(options: SendRequestOptions): Promise<Response> {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const timeoutError = (cause?: unknown) =>
    new EdTimeoutError(
      `Request to ${options.url} timed out after ${timeoutMs}ms`,
      'TIMEOUT_ERROR',
      0,
      cause,
    );
  // ponytail: one timer both aborts fetch and rejects the race, so a fetch
  // that ignores AbortSignal still times out; abort shapes differ per
  // runtime (AbortError/TimeoutError, reason/cause), hence the broad check.
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      try {
        controller.abort();
      } catch {}
      reject(timeoutError());
    }, timeoutMs);
    try {
      (timer as unknown as { unref?: () => void })?.unref?.();
    } catch {}
  });
  try {
    return await Promise.race([
      fetch(options.url, {
        method: options.method,
        headers: options.headers,
        body: options.body,
        signal: controller.signal,
      }),
      timeoutPromise,
    ]);
  } catch (error: any) {
    if (error instanceof EdTimeoutError) throw error;
    if (timedOut || controller.signal.aborted || isAbortLike(error)) {
      throw timeoutError(error);
    }
    throw new EdNetworkError((error as any)?.message ?? String(error), 'NETWORK_ERROR', 0, error);
  } finally {
    if (timer !== undefined) {
      try {
        clearTimeout(timer);
      } catch {}
    }
  }
}

function isAbortLike(error: any): boolean {
  const names = [error?.name, error?.reason?.name, error?.cause?.name, error?.code];
  return names.some((n) => n === 'AbortError' || n === 'TimeoutError' || n === 'ABORT_ERR');
}

export async function parseJsonResponse(response: Response): Promise<any> {
  if (response.status === 429) {
    throw new EdRateLimitError(
      'Rate limit exceeded',
      'RATE_LIMIT',
      429,
      undefined,
      parseRetryAfterMs(response.headers.get('retry-after')),
    );
  }

  if (response.status >= 500) {
    throw new EdServerError(`Server error: ${response.status}`, 'SERVER_ERROR', response.status);
  }

  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (error: any) {
    throw new EdParseError(
      `Failed to parse response as JSON (HTTP ${response.status}): ${text.slice(0, 200)}`,
      'PARSE_ERROR',
      response.status,
      error,
    );
  }
}

export function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return Math.min(Number(trimmed) * 1000, 30_000);
  }
  const when = Date.parse(trimmed);
  if (!Number.isNaN(when)) {
    return Math.min(Math.max(when - Date.now(), 0), 30_000);
  }
  return undefined;
}

function buildFormBody(body: unknown): string | undefined {
  if (isFormData(body)) return undefined;
  if (typeof body === 'string') return body;
  if (isPlainObject(body)) {
    return new URLSearchParams(
      Object.entries(body).map(
        ([key, value]) =>
          [key, typeof value === 'string' ? value : JSON.stringify(value)] as [string, string],
      ),
    ).toString();
  }

  return String(body);
}

function hasBody(body: unknown): body is NonNullable<unknown> {
  return body !== undefined && body !== null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !isFormData(value);
}
