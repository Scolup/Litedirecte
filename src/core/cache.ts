// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import { ctxNow, getStorage, isOnline } from './context';
import type { EdContext } from './context';
import { EdAuthError, EdOfflineError } from './errors';
import { sessionEndedError } from './request';
import { edFetch } from './fetch';
import { transform } from './transform';
import { setSyncState } from './sync';
import type { Resource } from '../types';

export const CACHE_TTL_MS = 60_000;
const MAX_ENTRIES = 300;
const DEAD_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const CACHE_PREFIX = 'ed_cache::';
const CACHE_INDEX = 'ed_cache_index';

export type { Resource };

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function fmtDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function mondayOf(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d;
}

function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

export function weekRanges(nowMs: number): {
  previous: [string, string];
  current: [string, string];
  next: [string, string];
} {
  const monday = mondayOf(new Date(nowMs));
  const prev = addDays(monday, -7);
  const next = addDays(monday, 7);
  const sunday = addDays(monday, 6);
  return {
    previous: [fmtDay(prev), fmtDay(addDays(prev, 6))],
    current: [fmtDay(monday), fmtDay(sunday)],
    next: [fmtDay(next), fmtDay(addDays(next, 6))],
  };
}

export function isMondaySundayWeek(start: string, end: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return false;
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return false;
  if ((s.getDay() + 6) % 7 !== 0) return false;
  if ((e.getDay() + 6) % 7 !== 6) return false;
  return Math.round((e.getTime() - s.getTime()) / 86_400_000) === 6;
}

function shiftWeek(start: string, days: number): string {
  const d = new Date(`${start}T00:00:00`);
  d.setDate(d.getDate() + days);
  return fmtDay(d);
}

export function neighbourWeeks(start: string, end: string): Array<[string, string]> | null {
  if (!isMondaySundayWeek(start, end)) return null;
  const prevStart = shiftWeek(start, -7);
  const nextStart = shiftWeek(start, 7);
  return [
    [prevStart, shiftWeek(prevStart, 6)],
    [nextStart, shiftWeek(nextStart, 6)],
  ];
}

export function keyFor(resource: Resource, accountId: number | string, suffix: string): string {
  return `${resource}|${String(accountId)}|${suffix}`;
}

export function resourceOfKey(key: string): Resource | null {
  const r = key.split('|')[0];
  return (r ?? null) as Resource | null;
}

/** Maintained when its request is one of `getAll`'s and its resource is not ignored. */
export function isMaintained(ctx: EdContext, key: string, nowMs: number): boolean {
  const resource = resourceOfKey(key);
  if (!resource) return false;
  if (ctx.fetchIgnore.includes(resource)) return false;
  const parts = key.split('|');
  const suffix = parts.slice(2).join('|');
  switch (resource) {
    case 'timetable': {
      const m = /^(\d{4}-\d{2}-\d{2})\.(\d{4}-\d{2}-\d{2})$/.exec(suffix);
      if (!m) return false;
      const weeks = weekRanges(nowMs);
      const pair = `${m[1]}.${m[2]}`;
      return (
        pair === `${weeks.previous[0]}.${weeks.previous[1]}` ||
        pair === `${weeks.current[0]}.${weeks.current[1]}` ||
        pair === `${weeks.next[0]}.${weeks.next[1]}`
      );
    }
    case 'messages':
      return suffix === 'list.year=.folder=.page=0';
    case 'cloud':
      return suffix === 'depth=3';
    case 'grades':
      return suffix === 'period=';
    case 'homework':
      return suffix === 'index';
    case 'timeline':
    case 'commonTimeline':
    case 'attendance':
    case 'settings':
    case 'qcms':
    case 'documents':
      return suffix === 'list';
    default:
      return false;
  }
}

type EntryState = 'fresh' | 'stale' | 'dead';

function entryState(ctx: EdContext, fetchedAt: number, key: string, now: number): EntryState {
  if (!Number.isFinite(fetchedAt) || fetchedAt > now) return 'dead';
  if (now - fetchedAt > DEAD_AFTER_MS) return 'dead';
  if (now - fetchedAt < CACHE_TTL_MS) return 'fresh';
  return isMaintained(ctx, key, now) ? 'stale' : 'dead';
}

function storageKeyFor(key: string): string {
  return `${CACHE_PREFIX}${key}`;
}

async function readIndex(ctx: EdContext): Promise<string[]> {
  try {
    const storage = getStorage(ctx);
    if (!storage) return [];
    const raw = await storage.get(CACHE_INDEX);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((k) => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

async function writeIndex(ctx: EdContext, keys: string[]): Promise<void> {
  try {
    await getStorage(ctx)?.set(CACHE_INDEX, JSON.stringify(keys));
  } catch (error) {
    try {
      await ctx.config.onError?.(error);
    } catch {}
  }
}

async function persistEntry(
  ctx: EdContext,
  key: string,
  raw: unknown,
  fetchedAt: number,
  resource: string,
  accountId: number | string,
): Promise<void> {
  try {
    const storage = getStorage(ctx);
    if (!storage) return;
    await storage.set(storageKeyFor(key), JSON.stringify({ raw, fetchedAt, resource, accountId }));
    const index = await readIndex(ctx);
    if (!index.includes(key)) {
      index.push(key);
      await writeIndex(ctx, index);
    }
  } catch (error) {
    try {
      await ctx.config.onError?.(error);
    } catch {}
  }
}

async function deletePersisted(ctx: EdContext, key: string): Promise<void> {
  try {
    await getStorage(ctx)?.delete(storageKeyFor(key));
  } catch {}
  try {
    const index = await readIndex(ctx);
    if (index.includes(key))
      await writeIndex(
        ctx,
        index.filter((k) => k !== key),
      );
  } catch {}
}

async function loadPersisted(
  ctx: EdContext,
  key: string,
): Promise<{
  raw: unknown;
  fetchedAt: number;
  resource: string;
  accountId: number | string;
} | null> {
  try {
    const raw = await getStorage(ctx)?.get(storageKeyFor(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !('raw' in parsed)) return null;
    return parsed;
  } catch (error) {
    try {
      await ctx.config.onError?.(error);
    } catch {}
    return null;
  }
}

function touchLru(ctx: EdContext, key: string): void {
  const slot = ctx.cacheMem.get(key);
  if (!slot) return;
  ctx.cacheMem.delete(key);
  ctx.cacheMem.set(key, slot);
  while (ctx.cacheMem.size > MAX_ENTRIES) {
    const oldest = ctx.cacheMem.keys().next().value as string | undefined;
    if (!oldest) break;
    ctx.cacheMem.delete(oldest);
  }
}

/** Load a persisted entry into the memory cache and return its transformed value. */
function promotePersisted(
  ctx: EdContext,
  key: string,
  persisted: { raw: unknown; fetchedAt: number },
  resource: string,
  accountId: number | string,
): unknown {
  const value = transform(persisted.raw);
  ctx.cacheMem.set(key, {
    rawJson: JSON.stringify(persisted.raw),
    value,
    fetchedAt: persisted.fetchedAt,
    resource,
    accountId,
  });
  touchLru(ctx, key);
  return value;
}

function emitCacheEvent(
  ctx: EdContext,
  type: string,
  resource?: string,
  key?: string,
  error?: unknown,
): void {
  for (const cb of [...ctx.cacheListeners]) {
    try {
      cb({ type, resource, key, error });
    } catch (err) {
      try {
        void ctx.config.onError?.(err);
      } catch {}
    }
  }
}

function notifyWatchers(ctx: EdContext, resource: string, key: string): void {
  for (const w of [...ctx.cacheWatchers]) {
    if (!w.resources.has(resource)) continue;
    try {
      w.cb({ resource, key });
    } catch (err) {
      try {
        void ctx.config.onError?.(err);
      } catch {}
    }
  }
}

function idList(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (Array.isArray(v.notes)) return v.notes as unknown[];
    const msgs = (v.messages as Record<string, unknown> | undefined)?.received;
    if (Array.isArray(msgs)) return msgs as unknown[];
  }
  return null;
}

function diffNewItems(
  ctx: EdContext,
  resource: string,
  prevValue: unknown,
  nextValue: unknown,
): void {
  if (resource !== 'grades' && resource !== 'messages' && resource !== 'timeline') return;
  const prev = idList(prevValue);
  const next = idList(nextValue);
  if (!prev || !next) return;
  const prevIds = new Set(prev.map((i: unknown) => (i as { id?: unknown })?.id));
  const event =
    resource === 'grades'
      ? 'newGrade'
      : resource === 'messages'
        ? 'newMessage'
        : 'newTimelineEntry';
  for (const item of next) {
    const id = (item as { id?: unknown })?.id;
    if (id === undefined || prevIds.has(id)) continue;
    try {
      ctx.emitter.emit(event, item, ctx.config.onError);
    } catch {}
  }
}

export interface CachedReadOptions {
  resource: Resource;
  key: string;
  accountId: number | string;
  force?: boolean;
  fetchRaw: () => Promise<unknown>;
}

export interface ReadResourceOptions {
  accountId: number | string;
  /** Cache-key tail identifying the exact query (dates, page, period, …). */
  suffix: string;
  body?: unknown;
  mockMode?: boolean;
  force?: boolean;
}

/**
 * Read one resource through the cache: POST `endpoint`, unwrap the `{ data }`
 * envelope, and cache under `keyFor(resource, accountId, suffix)`.
 *
 * `mockMode` bypasses the cache entirely, as every module's mock path does.
 * Taking `resource` once keeps the cache key and the entry's resource tag from
 * drifting apart.
 */
export async function readResource<T = unknown>(
  ctx: EdContext,
  resource: Resource,
  endpoint: string,
  opts: ReadResourceOptions,
): Promise<T> {
  if (opts.mockMode) {
    return (await edFetch<T>(ctx, endpoint, {
      method: 'POST',
      body: opts.body ?? {},
      mockMode: true,
    })) as T;
  }
  return (await cachedRead(ctx, {
    resource,
    key: keyFor(resource, opts.accountId, opts.suffix),
    accountId: opts.accountId,
    force: opts.force,
    fetchRaw: async () => {
      const envelope = await edFetch<{ data: unknown }>(ctx, endpoint, {
        method: 'POST',
        body: opts.body ?? {},
        returnEnvelope: true,
      });
      return envelope.data;
    },
  })) as T;
}

/**
 * Apply a local edit to every in-memory entry of `resource`, then persist it.
 *
 * EcoleDirecte mutations answer with no usable body, so the cache is patched
 * optimistically. `apply` receives each record found in the stored JSON and
 * returns true when it changed something. Entries whose payload the predicate
 * rejects are left untouched, and any storage failure is swallowed: a stale
 * cache is better than a failed mutation.
 */
export interface PatchResourceOptions {
  /** Record field holding the id to match against `ids` (`id`, `idDevoir`, …). */
  idField: string;
  /** Restrict to cache keys containing this fragment (e.g. `'|list.'`). */
  keyIncludes?: string;
  /** Mutate one record; return true when it actually changed something. */
  apply: (record: Record<string, unknown>, id: number) => boolean;
}

export function patchResourceEntries(
  ctx: EdContext,
  resource: Resource,
  ids: number[],
  opts: PatchResourceOptions,
): void {
  const wanted = new Set(ids);
  const visit = (node: unknown): boolean => {
    if (Array.isArray(node)) return node.reduce<boolean>((acc, item) => visit(item) || acc, false);
    if (!node || typeof node !== 'object') return false;
    const rec = node as Record<string, unknown>;
    let changed = false;
    const id = rec[opts.idField];
    if (typeof id === 'number' && wanted.has(id)) changed = opts.apply(rec, id);
    for (const value of Object.values(rec)) {
      if (visit(value)) changed = true;
    }
    return changed;
  };

  for (const [key, slot] of [...ctx.cacheMem.entries()]) {
    if (slot.resource !== resource) continue;
    if (opts.keyIncludes && !key.includes(opts.keyIncludes)) continue;
    try {
      const raw = JSON.parse(slot.rawJson) as unknown;
      if (!visit(raw)) continue;
      slot.rawJson = JSON.stringify(raw);
      slot.value = transform(raw);
      slot.fetchedAt = ctxNow(ctx);
      try {
        void getStorage(ctx)?.set(
          storageKeyFor(key),
          JSON.stringify({
            raw,
            fetchedAt: slot.fetchedAt,
            resource: slot.resource,
            accountId: slot.accountId,
          }),
        );
      } catch {}
    } catch {}
  }
}

/** Run `fn` as a background request (never prompts for credentials). */
export async function runAsBackground<T>(ctx: EdContext, fn: () => Promise<T>): Promise<T> {
  ctx.backgroundDepth++;
  try {
    return await fn();
  } finally {
    ctx.backgroundDepth--;
  }
}

export function isBackground(ctx: EdContext): boolean {
  return ctx.backgroundDepth > 0;
}

/**
 * Serve a cached value while offline. The read succeeds, but never silently:
 * the sync status flips to `offline` (once per transition) with the reason as
 * `lastError`, so an app can tell the data it holds is not live.
 */
function serveOffline(ctx: EdContext, value: unknown): unknown {
  if (ctx.syncState.state !== 'offline') {
    setSyncState(
      ctx,
      'offline',
      new EdOfflineError('No network connection, served from cache', 'OFFLINE'),
    );
  }
  return value;
}

/** Drop one entry from memory and from storage. Never throws. */
export async function deleteEntry(ctx: EdContext, key: string): Promise<void> {
  ctx.cacheMem.delete(key);
  await deletePersisted(ctx, key);
}

/** Drop every entry of `resource` whose key contains `keyIncludes`. Never throws. */
export async function deleteEntries(
  ctx: EdContext,
  resource: Resource,
  keyIncludes: string,
): Promise<void> {
  for (const [key, slot] of [...ctx.cacheMem.entries()]) {
    if (slot.resource !== resource || !key.includes(keyIncludes)) continue;
    await deleteEntry(ctx, key);
  }
}

export async function cachedRead(ctx: EdContext, opts: CachedReadOptions): Promise<unknown> {
  const now = ctxNow(ctx);
  const startGen = ctx.sessionGen;
  const { resource, key, accountId, force, fetchRaw } = opts;
  const background = isBackground(ctx);

  if (!force) {
    if (!isOnline(ctx)) {
      const offlineMem = ctx.cacheMem.get(key);
      if (offlineMem) {
        touchLru(ctx, key);
        return serveOffline(ctx, offlineMem.value);
      }
      const offlinePersisted = await loadPersisted(ctx, key);
      if (offlinePersisted && String(offlinePersisted.accountId) === String(accountId)) {
        return serveOffline(ctx, promotePersisted(ctx, key, offlinePersisted, resource, accountId));
      }
      throw new EdOfflineError('No network connection', 'OFFLINE');
    }
    const mem = ctx.cacheMem.get(key);
    if (mem) {
      const state = entryState(ctx, mem.fetchedAt, key, now);
      if (state === 'fresh') {
        touchLru(ctx, key);
        return mem.value;
      }
      if (state === 'stale') {
        touchLru(ctx, key);
        const value = mem.value;
        void revalidateStale(ctx, key, resource, accountId, fetchRaw, startGen);
        return value;
      }
      ctx.cacheMem.delete(key);
      void deletePersisted(ctx, key);
    } else {
      const persisted = await loadPersisted(ctx, key);
      if (persisted && String(persisted.accountId) === String(accountId)) {
        const state = entryState(ctx, persisted.fetchedAt, key, now);
        if (state === 'dead') {
          void deletePersisted(ctx, key);
        } else {
          const value = promotePersisted(ctx, key, persisted, resource, accountId);
          if (state === 'stale') {
            void revalidateStale(ctx, key, resource, accountId, fetchRaw, startGen);
          }
          return value;
        }
      } else if (persisted) {
        void deletePersisted(ctx, key);
      }
    }
  } else if (!isOnline(ctx)) {
    throw new EdOfflineError('No network connection', 'OFFLINE');
  }

  const inflight = ctx.cacheInflight.get(key);
  if (inflight) {
    const joined = await inflight;
    if (joined !== null && joined !== undefined) return joined;
  }

  const promise = (async () => {
    const gen = ctx.sessionGen;
    const raw = await fetchRaw();
    if (ctx.sessionGen !== gen || ctx.sessionGen !== startGen || ctx.destroyed) {
      throw sessionEndedError();
    }
    writeEntry(ctx, key, resource, accountId, raw, background);
    const slot = ctx.cacheMem.get(key);
    return slot?.value ?? transform(raw);
  })();
  ctx.cacheInflight.set(key, promise);
  try {
    return await promise;
  } finally {
    if (ctx.cacheInflight.get(key) === promise) ctx.cacheInflight.delete(key);
  }
}

async function revalidateStale(
  ctx: EdContext,
  key: string,
  resource: string,
  accountId: number | string,
  fetchRaw: () => Promise<unknown>,
  startGen: number,
): Promise<void> {
  if (ctx.cacheInflight.has(key)) {
    try {
      await ctx.cacheInflight.get(key);
    } catch {}
    return;
  }
  if (!isOnline(ctx)) return;
  const promise = (async () => {
    const gen = ctx.sessionGen;
    const raw = await runAsBackground(ctx, fetchRaw);
    if (ctx.sessionGen !== gen || ctx.sessionGen !== startGen || ctx.destroyed) return null;
    writeEntry(ctx, key, resource, accountId, raw, true);
    return ctx.cacheMem.get(key)?.value ?? null;
  })();
  ctx.cacheInflight.set(key, promise as Promise<unknown>);
  try {
    await promise;
  } catch (error) {
    if (
      error instanceof EdAuthError &&
      (error.code === 'SESSION_ENDED' || ctx.sessionGen !== startGen)
    )
      return;
    if (error instanceof EdAuthError) {
      try {
        const { setSyncAuthRequired } = await import('./sync');
        setSyncAuthRequired(ctx, error);
      } catch {}
    }
    emitCacheEvent(ctx, 'error', resource, key, error);
    try {
      await ctx.config.onError?.(error);
    } catch {}
  } finally {
    if (ctx.cacheInflight.get(key) === (promise as Promise<unknown>)) ctx.cacheInflight.delete(key);
  }
}

export function writeEntry(
  ctx: EdContext,
  key: string,
  resource: string,
  accountId: number | string,
  raw: unknown,
  _background: boolean,
): void {
  if (ctx.destroyed) return;
  const now = ctxNow(ctx);
  const rawJson = JSON.stringify(raw);
  const prev = ctx.cacheMem.get(key);
  const prevLiving = prev && entryState(ctx, prev.fetchedAt, key, now) !== 'dead' ? prev : null;
  if (prevLiving && prevLiving.rawJson === rawJson) {
    prevLiving.fetchedAt = now;
    touchLru(ctx, key);
    ctx.cacheLastSync.set(resource, now);
    void persistEntry(ctx, key, raw, now, resource, accountId);
    return;
  }
  const value = transform(raw);
  const hadLiving = Boolean(prevLiving);
  const prevValue = prevLiving?.value;
  ctx.cacheMem.delete(key);
  ctx.cacheMem.set(key, { rawJson, value, fetchedAt: now, resource, accountId });
  touchLru(ctx, key);
  ctx.cacheLastSync.set(resource, now);
  void persistEntry(ctx, key, raw, now, resource, accountId);
  if (hadLiving) {
    if (isMaintained(ctx, key, now)) diffNewItems(ctx, resource, prevValue, value);
  }
  if (!prevLiving || prevLiving.rawJson !== rawJson) {
    emitCacheEvent(ctx, 'update', resource, key);
    notifyWatchers(ctx, resource, key);
  }
}

/** Mark maintained entries stale; kill manual ones. */
export function invalidateEntries(ctx: EdContext, resource?: Resource): void {
  const now = ctxNow(ctx);
  for (const [key, slot] of [...ctx.cacheMem.entries()]) {
    if (resource && slot.resource !== resource) continue;
    if (isMaintained(ctx, key, now)) {
      slot.fetchedAt = now - CACHE_TTL_MS;
    } else {
      ctx.cacheMem.delete(key);
      void deletePersisted(ctx, key);
    }
  }
  void (async () => {
    try {
      const storage = getStorage(ctx);
      if (!storage) return;
      const rawIndex = await storage.get(CACHE_INDEX);
      if (!rawIndex) return;
      const index = JSON.parse(rawIndex) as string[];
      if (!Array.isArray(index)) return;
      const kept: string[] = [];
      for (const key of index) {
        if (typeof key !== 'string') continue;
        const res = resourceOfKey(key);
        if (!res || (resource && res !== resource)) {
          kept.push(key);
          continue;
        }
        if (ctx.cacheMem.has(key)) {
          kept.push(key);
          continue;
        }
        if (isMaintained(ctx, key, now)) {
          try {
            const raw = await storage.get(storageKeyFor(key));
            if (raw) {
              const parsed = JSON.parse(raw);
              parsed.fetchedAt = now - CACHE_TTL_MS;
              await storage.set(storageKeyFor(key), JSON.stringify(parsed));
              kept.push(key);
              continue;
            }
          } catch {}
        }
        try {
          await storage.delete(storageKeyFor(key));
        } catch {}
      }
      try {
        if (kept.length === 0) await storage.delete(CACHE_INDEX);
        else await storage.set(CACHE_INDEX, JSON.stringify(kept));
      } catch {}
    } catch {}
  })();
  emitCacheEvent(ctx, 'invalidate', resource);
}

/** Drop every in-memory and persisted cache entry of this instance (all accounts). */
async function dropAllEntries(ctx: EdContext): Promise<void> {
  ctx.cacheMem.clear();
  ctx.cacheInflight.clear();
  ctx.cacheLastSync.clear();
  try {
    const index = await readIndex(ctx);
    for (const key of index) {
      try {
        await getStorage(ctx)?.delete(storageKeyFor(key));
      } catch {}
    }
    try {
      await getStorage(ctx)?.delete(CACHE_INDEX);
    } catch {}
  } catch {}
}

export async function clearEntries(ctx: EdContext): Promise<void> {
  await dropAllEntries(ctx);
  emitCacheEvent(ctx, 'clear');
}

/** Purge every persisted cache entry of this instance (all accounts). */
export async function purgeCacheStorage(ctx: EdContext): Promise<void> {
  await dropAllEntries(ctx);
}

/** Delete dead entries lazily (on read, load, after getAll). No timers. */
export async function pruneDead(ctx: EdContext): Promise<void> {
  if (!isOnline(ctx)) return;
  const now = ctxNow(ctx);
  for (const [key, slot] of [...ctx.cacheMem.entries()]) {
    if (entryState(ctx, slot.fetchedAt, key, now) === 'dead') {
      ctx.cacheMem.delete(key);
      void deletePersisted(ctx, key);
    }
  }
}
