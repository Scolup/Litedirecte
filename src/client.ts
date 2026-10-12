// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import type { EdConfig, Resource } from './types';
import { EdAuthError, EdError, EdRateLimitError, EdValidationError } from './core/errors';
import {
  assertAlive,
  createContext,
  ctxNow,
  getConfig,
  isOnline,
  setConfig,
  validateFetchInterval,
  validateResourceList,
  type EdContext,
} from './core/context';
import { destroyRateLimiter } from './core/fetch';
import { notLoggedInError } from './core/request';
import { stopTokenKeepalive } from './core/health';
import {
  flushQueue,
  pushToQueue,
  removeOnlineFlushListener,
  ensureOnlineFlushListener,
} from './core/queue';
import { capabilities, supports, type ModuleKey } from './core/modules';
import { safeSetInterval, safeClearInterval } from './core/env';
import {
  CACHE_TTL_MS,
  clearEntries,
  invalidateEntries,
  runAsBackground,
  weekRanges,
} from './core/cache';
import { collectGetAll, touchGetAllSuccess, validateIgnore } from './core/getAll';
import { clearAuthPause, getSyncSnapshot, setSyncAuthRequired, setSyncState } from './core/sync';
import type { EventHandler, LitedirecteEvent, LitedirecteEvents } from './modules/listen/emitter';
import { AuthNamespace } from './auth/index';
import { GradesNamespace } from './modules/grades/index';
import { TimetableNamespace } from './modules/timetable/index';
import { HomeworkNamespace } from './modules/homework/index';
import { MessagesNamespace } from './modules/messages/index';
import { TimelineNamespace } from './modules/timeline/index';
import { AttendanceNamespace } from './modules/attendance/index';
import { CloudNamespace } from './modules/cloud/index';
import { DocumentsNamespace } from './modules/documents/index';
import { QcmsNamespace } from './modules/forms/index';
import { SettingsNamespace } from './modules/settings/index';
import { DownloadsNamespace } from './core/downloader';

export { CACHE_TTL_MS };
export type { Resource };

export interface GetAllOptions {
  ignore?: Resource[];
}

export interface AllData {
  grades?: unknown;
  timetable?: { previous: unknown; current: unknown; next: unknown };
  homework?: unknown;
  messages?: unknown;
  timeline?: unknown;
  commonTimeline?: unknown;
  attendance?: unknown;
  settings?: unknown;
  qcms?: unknown;
  documents?: unknown;
  cloud?: unknown;
  errors: Partial<Record<Resource, EdError>>;
  skipped: Resource[];
}

/**
 * An independent EcoleDirecte client. Each instance owns its session, config,
 * storage, request queues, refresh single-flight, rate budget, timers and
 * event listeners: logging out or destroying one never affects another.
 *
 * The constructor performs no I/O and never loads a session by itself;
 * call `await ld.auth.loadSession()` explicitly to restore a saved session.
 * Constructing the instance arms the built-in poller (state: running).
 *
 * @example
 * ```ts
 * const ld = new Litedirecte({ storage, maxRetries: 2 });
 * await ld.auth.login('john.doe', 'secret');
 * const grades = await ld.grades.getGrades();
 * await ld.homework.markAsDone([42]);
 * ld.destroy();
 * ```
 */
export class Litedirecte {
  readonly auth: AuthNamespace;
  readonly grades: GradesNamespace;
  readonly timetable: TimetableNamespace;
  readonly homework: HomeworkNamespace;
  readonly messages: MessagesNamespace;
  readonly timeline: TimelineNamespace;
  readonly attendance: AttendanceNamespace;
  readonly cloud: CloudNamespace;
  readonly documents: DocumentsNamespace;
  readonly qcms: QcmsNamespace;
  readonly settings: SettingsNamespace;
  readonly downloads: DownloadsNamespace;
  /**
   * Offline mutation queue API (`push`, `flush`, `getQueue`, `clear`).
   *
   * @example
   * ```ts
   * await ld.offlineQueue.flush();
   * ```
   */
  readonly offlineQueue: {
    push: (endpoint: string, options: Record<string, unknown>) => Promise<void>;
    flush: () => Promise<void>;
    getQueue: () => Array<{
      id: string;
      endpoint: string;
      options: Record<string, unknown>;
      timestamp: number;
      attempts: number;
    }>;
    clear: () => void;
  };

  /** Built-in per-instance cache API. */
  readonly cache: {
    watch: (
      resources: Resource | Resource[],
      callback: (event: { resource: string; key: string }) => void,
    ) => () => void;
    onEvent: (
      callback: (event: { type: string; resource?: string; key?: string; error?: unknown }) => void,
    ) => () => void;
    getLastSync: (resource: Resource) => Date | null;
    invalidate: (resource?: Resource) => void;
    clear: () => Promise<void>;
  };

  /** Single sync status for polls, prefetches and `getAll`. */
  readonly sync: {
    getState: () => { state: string; lastSync: number | null; lastError: unknown };
    onChange: (
      callback: (state: { state: string; lastSync: number | null; lastError: unknown }) => void,
    ) => () => void;
  };

  /** @internal: per-instance state. Reach in only from tests. */
  readonly ctx: EdContext;
  private pollOnlineHandler: (() => void) | null = null;

  constructor(config: EdConfig = {}) {
    this.ctx = createContext(config);
    this.auth = new AuthNamespace(this.ctx);
    this.grades = new GradesNamespace(this.ctx);
    this.timetable = new TimetableNamespace(this.ctx);
    this.homework = new HomeworkNamespace(this.ctx);
    this.messages = new MessagesNamespace(this.ctx);
    this.timeline = new TimelineNamespace(this.ctx);
    this.attendance = new AttendanceNamespace(this.ctx);
    this.cloud = new CloudNamespace(this.ctx);
    this.documents = new DocumentsNamespace(this.ctx);
    this.qcms = new QcmsNamespace(this.ctx);
    this.settings = new SettingsNamespace(this.ctx);
    this.downloads = new DownloadsNamespace(this.ctx);
    const ctx = this.ctx;
    this.offlineQueue = {
      push: (endpoint, options) => pushToQueue(ctx, endpoint, options),
      flush: () => flushQueue(ctx),
      getQueue: () => {
        assertAlive(ctx);
        return ctx.queue;
      },
      clear: () => {
        assertAlive(ctx);
        ctx.queue.length = 0;
        ctx.queueFlushPromise = null;
      },
    };
    this.cache = {
      watch: (resources, callback) => this.watchCache(resources, callback),
      onEvent: (callback) => {
        assertAlive(ctx);
        ctx.cacheListeners.add(callback);
        return () => void ctx.cacheListeners.delete(callback);
      },
      getLastSync: (resource) => {
        assertAlive(ctx);
        const ts = ctx.cacheLastSync.get(resource);
        return ts === undefined ? null : new Date(ts);
      },
      invalidate: (resource) => {
        assertAlive(ctx);
        if (resource !== undefined) validateResourceList([resource], 'resource');
        invalidateEntries(ctx, resource);
      },
      clear: async () => {
        assertAlive(ctx);
        await clearEntries(ctx);
      },
    };
    this.sync = {
      getState: () => {
        assertAlive(ctx);
        return getSyncSnapshot(ctx) as {
          state: string;
          lastSync: number | null;
          lastError: unknown;
        };
      },
      onChange: (callback) => {
        assertAlive(ctx);
        ctx.syncListeners.add(
          callback as (s: { state: string; lastSync: number | null; lastError: unknown }) => void,
        );
        return () =>
          void ctx.syncListeners.delete(
            callback as (s: { state: string; lastSync: number | null; lastError: unknown }) => void,
          );
      },
    };
    ctx.prefetchHook = (ignore) => {
      void this.prefetch(ignore);
    };
    this.ensurePollOnlineListener();
    this.armPollingTimer();
    if (getConfig(ctx).offlineQueue) ensureOnlineFlushListener(ctx);
  }

  /**
   * Update part of the instance config (validated exactly like the constructor).
   * Stores `fetchInterval` / `fetchIgnore` when provided; re-times the timer
   * only while polling is running.
   *
   * @example
   * ```ts
   * ld.configure({ maxRetries: 5 });
   * ```
   */
  configure = (partial: Partial<EdConfig>): void => {
    assertAlive(this.ctx);
    const touchesPolling = 'fetchInterval' in partial || 'fetchIgnore' in partial;
    setConfig(this.ctx, partial);
    if (getConfig(this.ctx).offlineQueue) ensureOnlineFlushListener(this.ctx);
    if (touchesPolling && this.ctx.pollingState === 'running' && 'fetchInterval' in partial) {
      this.armPollingTimer();
    }
  };

  /**
   * Fetch every resource in parallel, always from the network, and write each
   * result to the cache. One failing resource never rejects `getAll`.
   *
   * @example
   * ```ts
   * const all = await ld.getAll({ ignore: ['cloud'] });
   * ```
   */
  getAll = async (options: GetAllOptions = {}): Promise<AllData> => {
    assertAlive(this.ctx);
    const ignore = validateIgnore(options.ignore);
    return runAsBackground(this.ctx, () => this.getAllInner(ignore));
  };

  /**
   * Stop polling. Clears the timer and sets the state to stopped; nothing
   * restarts it except `resumePolling()`.
   *
   * @example
   * ```ts
   * ld.stopPolling();
   * ```
   */
  stopPolling = (): void => {
    this.clearPollingTimer();
    this.ctx.pollingState = 'stopped';
  };

  /**
   * Resume polling and optionally change polling settings. Idempotent; there
   * is never more than one timer. Clears an authentication pause.
   *
   * @example
   * ```ts
   * ld.resumePolling({ fetchInterval: 30 });
   * ```
   */
  resumePolling = (options: { fetchInterval?: number; fetchIgnore?: Resource[] } = {}): void => {
    assertAlive(this.ctx);
    if (options.fetchInterval !== undefined) validateFetchInterval(options.fetchInterval);
    if (options.fetchIgnore !== undefined) validateResourceList(options.fetchIgnore, 'fetchIgnore');
    const partial: Partial<EdConfig> = {};
    if (options.fetchInterval !== undefined) partial.fetchInterval = options.fetchInterval;
    if (options.fetchIgnore !== undefined) partial.fetchIgnore = options.fetchIgnore;
    if (Object.keys(partial).length > 0) setConfig(this.ctx, partial);
    this.ctx.pollingState = 'running';
    clearAuthPause(this.ctx);
    this.armPollingTimer();
    const intervalMs = this.ctx.fetchIntervalSec * 1000;
    const last = this.ctx.lastSuccessfulGetAllAt;
    const now = ctxNow(this.ctx);
    if (
      this.ctx.fetchIntervalSec !== 0 &&
      this.ctx.account &&
      isOnline(this.ctx) &&
      !this.ctx.authPaused &&
      !this.ctx.tickInFlight &&
      (last == null || now - last >= intervalMs)
    ) {
      void this.tick();
    }
  };

  /**
   * Subscribe to an event (`newGrade`, `newMessage`, `newTimelineEntry`, `pollingError`).
   *
   * @example
   * ```ts
   * const off = ld.on('newGrade', (grade) => console.log(grade));
   * ```
   */
  on = <T extends LitedirecteEvent>(
    event: T,
    handler: EventHandler<LitedirecteEvents[T]>,
  ): (() => void) => {
    assertAlive(this.ctx);
    return this.ctx.emitter.on(event, handler);
  };

  /**
   * Unsubscribe a handler.
   *
   * @example
   * ```ts
   * ld.off('newGrade', handler);
   * ```
   */
  off = <T extends LitedirecteEvent>(
    event: T,
    handler: EventHandler<LitedirecteEvents[T]>,
  ): void => {
    assertAlive(this.ctx);
    this.ctx.emitter.off(event, handler);
  };

  /**
   * Whether the current account supports a checked namespace
   * (`true` for unchecked namespaces and when modules are unknown).
   *
   * @example
   * ```ts
   * if (ld.supports('grades')) await ld.grades.getGrades();
   * ```
   */
  supports = (key: ModuleKey | (string & {})): boolean => {
    assertAlive(this.ctx);
    return supports(this.ctx, key);
  };

  /**
   * Support map for every checked namespace. Follows `switchAccount`.
   *
   * @example
   * ```ts
   * const caps = ld.capabilities();
   * ```
   */
  capabilities = (): Record<ModuleKey, boolean> => {
    assertAlive(this.ctx);
    return capabilities(this.ctx);
  };

  /**
   * Stop every timer, remove every global listener, clear listeners and drop
   * queued rate-limited requests. Idempotent; using the instance afterwards
   * throws `EdValidationError('Instance destroyed')`.
   *
   * @example
   * ```ts
   * ld.destroy();
   * ```
   */
  destroy = (): void => {
    if (this.ctx.destroyed) return;
    this.ctx.sessionGen++;
    this.ctx.destroyed = true;
    this.clearPollingTimer();
    stopTokenKeepalive(this.ctx);
    removeOnlineFlushListener(this.ctx);
    this.removePollOnlineListener();
    this.ctx.emitter.clear();
    this.ctx.cacheListeners.clear();
    this.ctx.cacheWatchers.length = 0;
    this.ctx.syncListeners.clear();
    destroyRateLimiter(this.ctx, new EdValidationError('Instance destroyed', 'INVALID_ARGUMENT'));
    this.ctx.limiter.queue.length = 0;
    this.ctx.queue.length = 0;
    this.ctx.queueFlushPromise = null;
  };

  private watchCache(
    resources: Resource | Resource[],
    callback: (event: { resource: string; key: string }) => void,
  ): () => void {
    assertAlive(this.ctx);
    const list = Array.isArray(resources) ? resources : [resources];
    validateResourceList(list, 'resources');
    const entry = { resources: new Set<string>(list), cb: callback };
    this.ctx.cacheWatchers.push(entry);
    return () => {
      const i = this.ctx.cacheWatchers.indexOf(entry);
      if (i >= 0) this.ctx.cacheWatchers.splice(i, 1);
    };
  }

  private async getAllInner(ignore: Resource[]): Promise<AllData> {
    const ctx = this.ctx;
    if (!ctx.account) {
      throw notLoggedInError();
    }
    setSyncState(ctx, 'syncing');
    const weeks = weekRanges(ctxNow(ctx));
    const jobs = {
      grades: () => this.grades.getGrades({ force: true }),
      timetable: async () => {
        const [previous, current, next] = await Promise.all([
          this.timetable.getTimetable({
            startDate: weeks.previous[0],
            endDate: weeks.previous[1],
            force: true,
          }),
          this.timetable.getTimetable({
            startDate: weeks.current[0],
            endDate: weeks.current[1],
            force: true,
          }),
          this.timetable.getTimetable({
            startDate: weeks.next[0],
            endDate: weeks.next[1],
            force: true,
          }),
        ]);
        return { previous, current, next };
      },
      homework: () => this.homework.getHomework({ force: true }),
      messages: () => this.messages.getMessages({ force: true }),
      timeline: () => this.timeline.getTimeline({ force: true }),
      commonTimeline: () => this.timeline.getCommonTimeline({ force: true }),
      attendance: () => this.attendance.getAttendance({ force: true }),
      settings: () => this.settings.getSettings({ force: true }),
      qcms: () => this.qcms.getQcms({ force: true }),
      documents: () => this.documents.getDocuments({ force: true }),
      cloud: () => this.cloud.getCloud({ force: true }),
    } as Record<Resource, () => Promise<unknown>>;
    try {
      const result = await collectGetAll(ctx, ignore, jobs, (out, resource, value) => {
        out[resource] = value;
      });
      touchGetAllSuccess(ctx);
      if (Object.keys(result.errors).length > 0) {
        const first = Object.values(result.errors)[0];
        setSyncState(ctx, 'error', first);
      } else {
        setSyncState(ctx, 'idle');
      }
      return result as AllData;
    } catch (error) {
      if (error instanceof EdAuthError) {
        if ((error as EdAuthError).code === 'SESSION_ENDED') throw error;
        if ((error as EdAuthError).code === 'NOT_LOGGED_IN') throw error;
        setSyncAuthRequired(ctx, error);
      } else {
        setSyncState(ctx, 'error', error);
      }
      throw error;
    }
  }

  /** Background prefetch after login / account switch. Never throws. */
  private async prefetch(ignore?: Resource[]): Promise<void> {
    const ctx = this.ctx;
    if (ctx.destroyed || !ctx.account) return;
    const list = ignore ?? ctx.fetchIgnore;
    try {
      await runAsBackground(ctx, () => this.getAllInner(validateIgnore(list)));
      if (ctx.pollingState === 'running') this.armPollingTimer();
    } catch {}
  }

  private clearPollingTimer(): void {
    const handle = this.ctx.pollingTimer;
    this.ctx.pollingTimer = null;
    if (handle != null) {
      try {
        clearInterval(handle as unknown as ReturnType<typeof setInterval>);
      } catch {}
      try {
        clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
      } catch {}
    }
    safeClearInterval(undefined);
  }

  private armPollingTimer(): void {
    const ctx = this.ctx;
    this.clearPollingTimer();
    if (ctx.pollingState !== 'running') return;
    if (ctx.fetchIntervalSec === 0) return;
    try {
      ctx.pollingTimer = safeSetInterval(() => void this.tick(), ctx.fetchIntervalSec * 1000);
    } catch {
      ctx.pollingTimer = null;
    }
  }

  private async tick(): Promise<void> {
    const ctx = this.ctx;
    if (ctx.destroyed || ctx.pollingState !== 'running') return;
    if (ctx.authPaused) return;
    if (!ctx.account) return;
    if (ctx.tickInFlight) return;
    const now = ctxNow(ctx);
    if (now < ctx.rateLimitDelayUntil) return;
    if (!isOnline(ctx)) {
      if (ctx.syncState.state !== 'auth-required') setSyncState(ctx, 'offline');
      return;
    }
    ctx.tickInFlight = true;
    try {
      const result = await runAsBackground(ctx, () => this.getAllInner([...ctx.fetchIgnore]));
      touchGetAllSuccess(ctx);
      const entries = Object.entries(result.errors);
      if (entries.length > 0) {
        let maxRetryAfter = 0;
        for (const [, err] of entries) {
          if (err instanceof EdRateLimitError && err.retryAfterMs !== undefined) {
            maxRetryAfter = Math.max(maxRetryAfter, err.retryAfterMs);
          }
          ctx.emitter.emit('pollingError', err, getConfig(ctx).onError);
        }
        const intervalMs = ctx.fetchIntervalSec * 1000;
        if (maxRetryAfter > intervalMs) ctx.rateLimitDelayUntil = ctxNow(ctx) + maxRetryAfter;
      }
    } catch (error) {
      if (ctx.destroyed) return;
      if (getConfig(ctx) && (error as EdAuthError)?.code === 'SESSION_ENDED') return;
      if (!ctx.account) return;
      if (error instanceof EdRateLimitError && error.retryAfterMs !== undefined) {
        const intervalMs = ctx.fetchIntervalSec * 1000;
        if (error.retryAfterMs > intervalMs) {
          ctx.rateLimitDelayUntil = ctxNow(ctx) + error.retryAfterMs;
        }
        ctx.emitter.emit('pollingError', error, getConfig(ctx).onError);
        return;
      }
      if (error instanceof EdAuthError) {
        setSyncAuthRequired(ctx, error);
        ctx.emitter.emit('pollingError', error, getConfig(ctx).onError);
        return;
      }
      if (!isOnline(ctx)) {
        if (ctx.syncState.state !== 'auth-required') setSyncState(ctx, 'offline', error);
        return;
      }
      setSyncState(ctx, 'error', error);
      ctx.emitter.emit(
        'pollingError',
        error instanceof EdError ? error : new EdError(String(error), 'UNKNOWN'),
        getConfig(ctx).onError,
      );
    } finally {
      ctx.tickInFlight = false;
    }
  }

  private ensurePollOnlineListener(): void {
    if (this.pollOnlineHandler) return;
    try {
      const add = (globalThis as unknown as { addEventListener?: unknown }).addEventListener;
      if (typeof add !== 'function') return;
      const handler = () => {
        try {
          const ctx = this.ctx;
          if (ctx.destroyed) return;
          if (getConfig(ctx).offlineQueue) void flushQueue(ctx).catch(() => {});
          if (ctx.pollingState !== 'running' || ctx.authPaused || !ctx.account) return;
          const intervalMs = ctx.fetchIntervalSec * 1000;
          const last = ctx.lastSuccessfulGetAllAt;
          const now = ctxNow(ctx);
          if ((last == null || now - last >= intervalMs) && !ctx.tickInFlight && isOnline(ctx)) {
            void this.tick();
          }
        } catch {}
      };
      this.pollOnlineHandler = handler;
      (add as (type: string, h: () => void) => void).call(globalThis, 'online', handler);
    } catch {}
  }

  private removePollOnlineListener(): void {
    if (!this.pollOnlineHandler) return;
    try {
      const remove = (globalThis as unknown as { removeEventListener?: unknown })
        .removeEventListener;
      if (typeof remove === 'function') {
        (remove as (type: string, h: () => void) => void).call(
          globalThis,
          'online',
          this.pollOnlineHandler,
        );
      }
    } catch {}
    this.pollOnlineHandler = null;
  }
}
