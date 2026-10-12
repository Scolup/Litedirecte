// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import type { Account, EdConfig, StorageAdapter } from '../types';
import { EdValidationError } from './errors';
import { ED_VERSION } from './http';
import {
  createMemoryStorage,
  localStorageStorage,
  indexedDBStorage,
  nodeStorage,
  encryptedStorage,
  namespacedStorage,
} from './storage';
import { EventEmitter } from '../modules/listen/emitter';

/** All mutable state owned by one Litedirecte instance. No module-level mutable state remains. */
export interface EdContext {
  config: EdConfig;
  rawStorage?: StorageAdapter;
  hasDetectedStorage: boolean;
  token?: string;
  twofaToken?: string;
  account?: Account;
  accounts?: Account[];
  lastTokenRefresh?: Date;
  sessionGen: number;
  defaultUserAgent: string;
  refreshPromise: Promise<string | undefined> | null;
  /** True while the shared refresh promise is a silent (non-interactive) attempt. */
  refreshSilent?: boolean;
  /** Last completed refresh (success or auth failure): late 521s reuse it. */
  lastRefreshDoneAt: number;
  lastRefreshOk: boolean;
  limiter: { concurrency: number; active: number; queue: Array<() => void> };
  lastTokenPersistAt: number;
  rate: {
    hits: number[];
    waiters: Array<{ resolve: () => void; reject: (e: unknown) => void }>;
    timer?: ReturnType<typeof setTimeout>;
  };
  /** Injectable clock (tests only). */
  clock?: () => number;
  queue: QueuedMutation[];
  queueLoaded: boolean;
  queueFlushPromise: Promise<void> | null;
  queueWriteChain: Promise<unknown>;
  queueOpChain: Promise<unknown>;
  onlineHandler: (() => void) | null;
  keepaliveTimer: ReturnType<typeof setInterval> | undefined | null;
  pollingTimer: ReturnType<typeof setInterval> | undefined | null;
  /** Built-in poller state. */
  pollingState: 'running' | 'stopped';
  fetchIntervalSec: number;
  fetchIgnore: import('../types').Resource[];
  lastSuccessfulGetAllAt: number | null;
  tickInFlight: boolean;
  rateLimitDelayUntil: number;
  authPaused: boolean;
  backgroundDepth: number;
  emitter: EventEmitter;
  destroyed: boolean;
  /** Per-instance cache state (see core/cache.ts). */
  cacheMem: Map<
    string,
    {
      rawJson: string;
      value: unknown;
      fetchedAt: number;
      resource: string;
      accountId: number | string;
    }
  >;
  cacheInflight: Map<string, Promise<unknown>>;
  cacheWatchers: Array<{
    resources: Set<string>;
    cb: (e: { resource: string; key: string }) => void;
  }>;
  cacheListeners: Set<
    (e: { type: string; resource?: string; key?: string; error?: unknown }) => void
  >;
  cacheLastSync: Map<string, number>;
  syncState: {
    state: 'signed-out' | 'idle' | 'syncing' | 'offline' | 'error' | 'auth-required';
    lastSync: number | null;
    lastError: unknown;
  };
  syncListeners: Set<(s: { state: string; lastSync: number | null; lastError: unknown }) => void>;
  /** Set by the client: background `getAll` prefetch after login/switch. */
  prefetchHook?: (ignore?: import('../types').Resource[]) => void;
}

export interface QueuedMutation {
  id: string;
  endpoint: string;
  options: Record<string, unknown>;
  timestamp: number;
  attempts: number;
}

export function defaultConfig(): EdConfig {
  return {
    maxRetries: 3,
    retryDelay: 500,
    concurrency: 3,
    timeout: 15000,
    offlineQueue: false,
    userAgent: '',
    storageNamespace: '',
    maxRequestsPerMinute: 100,
    fetchInterval: 60,
    fetchIgnore: [],
  };
}

export const ALL_RESOURCES = [
  'grades',
  'timetable',
  'homework',
  'messages',
  'timeline',
  'commonTimeline',
  'attendance',
  'settings',
  'qcms',
  'documents',
  'cloud',
] as const;

export function validateResourceList(value: unknown, name: string): void {
  if (!Array.isArray(value)) {
    throw new EdValidationError(
      `${name} must be an array, got ${JSON.stringify(value)}`,
      'INVALID_ARGUMENT',
    );
  }
  for (const r of value) {
    if (!(ALL_RESOURCES as readonly string[]).includes(r as string)) {
      throw new EdValidationError(`unknown resource "${String(r)}" in ${name}`, 'INVALID_ARGUMENT');
    }
  }
}

export function validateFetchInterval(value: unknown): void {
  if (value === undefined) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || (value !== 0 && value < 5)) {
    throw new EdValidationError(
      `fetchInterval must be 0 or a finite number >= 5 (seconds), got ${JSON.stringify(value)}`,
      'INVALID_ARGUMENT',
    );
  }
}

/** Guarded online probe: `navigator.onLine` where available, else online. Never throws. */
export function isOnline(ctx: EdContext): boolean {
  try {
    const fn = getConfig(ctx).isOnline;
    if (typeof fn === 'function') {
      try {
        return fn();
      } catch {
        return true;
      }
    }
    const nav = (globalThis as unknown as { navigator?: { onLine?: unknown } }).navigator;
    if (nav && typeof nav.onLine === 'boolean') return nav.onLine;
    return true;
  } catch {
    return true;
  }
}

export function ctxNow(ctx: EdContext): number {
  return ctx.clock ? ctx.clock() : Date.now();
}

export function createContext(config: EdConfig = {}): EdContext {
  const ctx: EdContext = {
    config: defaultConfig(),
    hasDetectedStorage: false,
    sessionGen: 0,
    defaultUserAgent: '',
    refreshPromise: null,
    lastRefreshDoneAt: 0,
    lastRefreshOk: false,
    limiter: { concurrency: 3, active: 0, queue: [] },
    lastTokenPersistAt: 0,
    rate: { hits: [], waiters: [] },
    queue: [],
    queueLoaded: false,
    queueFlushPromise: null,
    queueWriteChain: Promise.resolve(),
    queueOpChain: Promise.resolve(),
    onlineHandler: null,
    keepaliveTimer: null,
    pollingTimer: null,
    pollingState: 'running',
    fetchIntervalSec: 60,
    fetchIgnore: [],
    lastSuccessfulGetAllAt: null,
    tickInFlight: false,
    rateLimitDelayUntil: 0,
    authPaused: false,
    backgroundDepth: 0,
    emitter: new EventEmitter(),
    destroyed: false,
    cacheMem: new Map(),
    cacheInflight: new Map(),
    cacheWatchers: [],
    cacheListeners: new Set(),
    cacheLastSync: new Map(),
    syncState: { state: 'signed-out', lastSync: null, lastError: null },
    syncListeners: new Set(),
  };
  setConfig(ctx, config);
  if (config.fetchInterval !== undefined) ctx.fetchIntervalSec = config.fetchInterval;
  if (config.fetchIgnore !== undefined) ctx.fetchIgnore = [...config.fetchIgnore];
  return ctx;
}

export function assertAlive(ctx: EdContext): void {
  if (ctx.destroyed) throw new EdValidationError('Instance destroyed', 'INVALID_ARGUMENT');
}

/** Assigns the token and stamps the refresh time every other write relies on. */
export function setToken(ctx: EdContext, token: string): void {
  ctx.token = token;
  ctx.lastTokenRefresh = new Date();
}

export function buildDefaultUserAgent(): string {
  return `Litedirecte/1.0 (iPhone; CPU OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Mobile/15E148 EDMOBILE v${ED_VERSION}`;
}

export function getConfig(ctx: EdContext): EdConfig {
  assertAlive(ctx);
  if (!ctx.defaultUserAgent) ctx.defaultUserAgent = buildDefaultUserAgent();
  if (!ctx.config.userAgent) ctx.config.userAgent = ctx.defaultUserAgent;
  getStorage(ctx);
  return ctx.config;
}

/**
 * The resolved storage adapter, detecting the platform default on first use.
 *
 * Safe to call from any path (including cache writes during teardown): unlike
 * `getConfig` it never throws on a destroyed instance.
 */
export function getStorage(ctx: EdContext): StorageAdapter | undefined {
  if (!ctx.config.storage && !ctx.hasDetectedStorage && !ctx.destroyed) detectStorage(ctx);
  return ctx.config.storage;
}

/** Pick the best available storage backend (idb > localStorage > file > memory). */
function detectStorage(ctx: EdContext): void {
  const proc = (globalThis as unknown as { process?: { versions?: Record<string, string> } })
    .process;
  ctx.hasDetectedStorage = true;
  ctx.rawStorage =
    typeof (globalThis as unknown as Record<string, unknown>).indexedDB !== 'undefined'
      ? indexedDBStorage
      : typeof (globalThis as unknown as Record<string, unknown>).localStorage !== 'undefined'
        ? localStorageStorage
        : proc && proc.versions && (proc.versions.node != null || proc.versions.bun != null)
          ? nodeStorage()
          : createMemoryStorage();
  wrapStorage(ctx);
}

/** Apply the namespace and passkey wrappers to the detected raw adapter. */
function wrapStorage(ctx: EdContext): void {
  const namespace = ctx.config.storageNamespace ?? '';
  const base = ctx.rawStorage
    ? namespace
      ? namespacedStorage(ctx.rawStorage, namespace)
      : ctx.rawStorage
    : undefined;
  const passkey = ctx.config.passkey;
  ctx.config.storage = base
    ? passkey
      ? encryptedStorage(base, passkey, () => ctx.config.onError)
      : base
    : undefined;
}

export function setConfig(ctx: EdContext, config: Partial<EdConfig>): void {
  assertAlive(ctx);
  validateConfig(config);
  const proxyUrl = config.proxyUrl !== undefined ? normalizeProxyUrl(config.proxyUrl) : undefined;

  if ('storage' in config) {
    ctx.rawStorage = config.storage;
    ctx.hasDetectedStorage = config.storage !== undefined;
    ctx.queueLoaded = false;
  } else if (!ctx.hasDetectedStorage && !ctx.rawStorage && !ctx.config.storage) {
    detectStorage(ctx);
  }

  if ('passkey' in config || 'storageNamespace' in config || 'storage' in config) {
    ctx.queueLoaded = false;
  }

  ctx.config = { ...ctx.config, ...config };
  if (proxyUrl !== undefined) ctx.config.proxyUrl = proxyUrl;
  if (config.fetchInterval !== undefined) ctx.fetchIntervalSec = config.fetchInterval;
  if (config.fetchIgnore !== undefined) ctx.fetchIgnore = [...config.fetchIgnore];
  wrapStorage(ctx);
  const concurrency = ctx.config.concurrency ?? 3;
  if (ctx.limiter.concurrency !== concurrency) {
    ctx.limiter.concurrency = concurrency;
  }
}

export function validateConfig(config: Partial<EdConfig>): void {
  if (config.concurrency !== undefined) {
    if (!Number.isInteger(config.concurrency) || config.concurrency < 1) {
      throw new EdValidationError(
        `concurrency must be an integer >= 1, got ${JSON.stringify(config.concurrency)}`,
        'INVALID_ARGUMENT',
      );
    }
  }
  if (config.timeout !== undefined) {
    if (
      typeof config.timeout !== 'number' ||
      !Number.isFinite(config.timeout) ||
      config.timeout <= 0
    ) {
      throw new EdValidationError(
        `timeout must be a finite number > 0, got ${JSON.stringify(config.timeout)}`,
        'INVALID_ARGUMENT',
      );
    }
  }
  if (config.maxRetries !== undefined) {
    if (!Number.isInteger(config.maxRetries) || config.maxRetries < 0) {
      throw new EdValidationError(
        `maxRetries must be an integer >= 0, got ${JSON.stringify(config.maxRetries)}`,
        'INVALID_ARGUMENT',
      );
    }
  }
  if (config.retryDelay !== undefined) {
    if (
      typeof config.retryDelay !== 'number' ||
      !Number.isFinite(config.retryDelay) ||
      config.retryDelay < 0
    ) {
      throw new EdValidationError(
        `retryDelay must be a finite number >= 0, got ${JSON.stringify(config.retryDelay)}`,
        'INVALID_ARGUMENT',
      );
    }
  }
  if (config.proxyUrl !== undefined) normalizeProxyUrl(config.proxyUrl);
  if (config.storageNamespace !== undefined) {
    if (typeof config.storageNamespace !== 'string' || /\s/.test(config.storageNamespace)) {
      throw new EdValidationError(
        `storageNamespace must be a string without whitespace, got ${JSON.stringify(config.storageNamespace)}`,
        'INVALID_ARGUMENT',
      );
    }
  }
  if (config.maxRequestsPerMinute !== undefined) {
    if (!Number.isInteger(config.maxRequestsPerMinute) || config.maxRequestsPerMinute < 0) {
      throw new EdValidationError(
        `maxRequestsPerMinute must be an integer >= 0, got ${JSON.stringify(config.maxRequestsPerMinute)}`,
        'INVALID_ARGUMENT',
      );
    }
  }
  if (config.fetchInterval !== undefined) validateFetchInterval(config.fetchInterval);
  if (config.fetchIgnore !== undefined) validateResourceList(config.fetchIgnore, 'fetchIgnore');
  if (config.isOnline !== undefined && typeof config.isOnline !== 'function') {
    throw new EdValidationError(
      `isOnline must be a function, got ${JSON.stringify(config.isOnline)}`,
      'INVALID_ARGUMENT',
    );
  }
}

function normalizeProxyUrl(value: string): string {
  if (typeof value !== 'string') {
    throw new EdValidationError(
      `proxyUrl must be a valid absolute http(s) URL, got ${JSON.stringify(value)}`,
      'INVALID_ARGUMENT',
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new EdValidationError(
      `proxyUrl must be a valid absolute http(s) URL, got ${JSON.stringify(value)}`,
      'INVALID_ARGUMENT',
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new EdValidationError(
      `proxyUrl must be a valid absolute http(s) URL, got ${JSON.stringify(value)}`,
      'INVALID_ARGUMENT',
    );
  }
  return value.replace(/\/+$/, '');
}
