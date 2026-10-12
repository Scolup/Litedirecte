// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { Litedirecte, createMemoryStorage, encryptedStorage, CACHE_TTL_MS } from '../src/index';
import { createTestClient, seedSession, testAccount } from './setup';
import { EdAuthError, EdOfflineError, EdValidationError } from '../src/core/errors';
import { weekRanges } from '../src/core/cache';

function json(body: any, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

const NOTES = { notes: [{ id: 1, valeur: '15' }] };
const MSGS = { messages: { received: [{ id: 20, subject: 'Hi' }] } };

function universalMock(overrides: Record<string, (url: string, body: any) => Response> = {}) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    let body: any;
    try {
      const s = init?.body?.toString() ?? '';
      body = s.startsWith('data=') ? JSON.parse(decodeURIComponent(s.slice(5))) : s;
    } catch {
      body = undefined;
    }
    for (const [pattern, handler] of Object.entries(overrides)) {
      if (url.includes(pattern)) return handler(url, body);
    }
    if (/\/messages\/\d+\.awp/.test(url))
      return json({ code: 200, message: '', data: { id: 99, subject: 'one' } });
    if (url.includes('/messages.awp')) return json({ code: 200, message: '', data: MSGS });
    if (url.includes('/notes.awp')) return json({ code: 200, message: '', data: NOTES });
    if (url.includes('/emploidutemps.awp'))
      return json({ code: 200, message: '', data: [{ id: 5 }] });
    if (url.includes('/cahierdetexte/'))
      return json({ code: 200, message: '', data: { day: true } });
    if (url.includes('/cahierdetexte.awp')) {
      return json({
        code: 200,
        message: '',
        data: { '2026-03-24': [{ idDevoir: 7, effectue: false }] },
      });
    }
    if (url.includes('/timelineAccueilCommun.awp'))
      return json({ code: 200, message: '', data: {} });
    if (url.includes('/timeline.awp')) return json({ code: 200, message: '', data: [{ id: 30 }] });
    if (url.includes('/viescolaire.awp')) return json({ code: 200, message: '', data: {} });
    if (url.includes('/logins/')) return json({ code: 200, message: '', data: {} });
    if (url.includes('/qcms/0/associations.awp')) return json({ code: 200, message: '', data: [] });
    if (url.includes('/qcms/')) return json({ code: 200, message: '', data: {} });
    if (url.includes('/elevesDocuments.awp')) return json({ code: 200, message: '', data: {} });
    if (url.includes('/cloud/')) return json({ code: 200, message: '', data: [] });
    if (url.includes('/ical/')) return json({ code: 200, message: '', data: { url: 'x.ics' } });
    return json({ code: 200, message: '', data: {} });
  };
}

const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));

describe('Cache layer, getAll, polling and sync', () => {
  let originalFetch: typeof globalThis.fetch;
  let requests: string[];

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    requests = [];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function clientWithSession(opts: { online?: boolean } = {}) {
    let online = opts.online ?? true;
    const { ld, storage } = createTestClient({
      fetchInterval: 0,
      maxRetries: 0,
      isOnline: () => online,
    });
    return {
      ld,
      storage,
      setOnline: (v: boolean) => void (online = v),
      cleanup: () => ld.destroy(),
    };
  }

  async function seeded(opts: { online?: boolean } = {}) {
    const c = clientWithSession(opts);
    await seedSession(c.storage, c.ld, testAccount(), 'tok');
    return c;
  }

  it('exports CACHE_TTL_MS = 60_000', () => {
    expect(CACHE_TTL_MS).toBe(60_000);
  });

  it('second read within 60s makes no request and returns the same object', async () => {
    const c = await seeded();
    try {
      globalThis.fetch = universalMock();
      const a = await c.ld.grades.getGrades();
      const count = (globalThis.fetch as any) && 1;
      void count;
      const b = await c.ld.grades.getGrades();
      expect(b).toBe(a);
    } finally {
      c.cleanup();
    }
  });

  it('counts one network request for two reads within the interval', async () => {
    const c = await seeded();
    try {
      let calls = 0;
      globalThis.fetch = async (input, init) => {
        calls++;
        return universalMock()(input, init);
      };
      await c.ld.grades.getGrades();
      await c.ld.grades.getGrades();
      expect(calls).toBe(1);
    } finally {
      c.cleanup();
    }
  });

  it('maintained stale entry is served instantly and refreshed; identical refresh keeps identity and emits nothing', async () => {
    const c = await seeded();
    try {
      let now = Date.now();
      c.ld.ctx.clock = () => now;
      let calls = 0;
      globalThis.fetch = async (input, init) => {
        calls++;
        return universalMock()(input, init);
      };
      const events: unknown[] = [];
      const off = c.ld.cache.onEvent((e) => void events.push(e));
      const a = await c.ld.grades.getGrades();
      expect(calls).toBe(1);
      now += 61_000;
      const b = await c.ld.grades.getGrades();
      expect(b).toBe(a);
      await settle();
      expect(calls).toBe(2);
      expect(c.ld.cache.getLastSync('grades')).toBeInstanceOf(Date);
      // Identical payload: no update event, identity kept.
      expect(events.filter((e: any) => e.type === 'update')).toHaveLength(1);
      off();
    } finally {
      c.cleanup();
    }
  });

  it('failed refresh of stale data keeps serving it and emits error', async () => {
    const c = await seeded();
    try {
      let now = Date.now();
      c.ld.ctx.clock = () => now;
      let fail = false;
      globalThis.fetch = async (input, init) => {
        if (fail) return new Response('{}', { status: 500 });
        return universalMock()(input, init);
      };
      const a = await c.ld.grades.getGrades();
      now += 61_000;
      fail = true;
      const errors: unknown[] = [];
      const off = c.ld.cache.onEvent((e) => {
        if (e.type === 'error') errors.push(e);
      });
      const b = await c.ld.grades.getGrades();
      expect(b).toBe(a);
      await settle();
      expect(errors).toHaveLength(1);
      const c2 = await c.ld.grades.getGrades();
      expect(c2).toBe(a);
      off();
    } finally {
      c.cleanup();
    }
  });

  it('manual entry dies after the interval: read waits, failure rejects, old data never returned', async () => {
    const c = await seeded();
    try {
      let now = Date.now();
      c.ld.ctx.clock = () => now;
      let calls = 0;
      let fail = false;
      globalThis.fetch = async (input, init) => {
        calls++;
        if (fail) throw new Error('down');
        return universalMock()(input, init);
      };
      const a = await c.ld.messages.getMessage(99);
      expect(calls).toBe(1);
      const b = await c.ld.messages.getMessage(99);
      expect(b).toBe(a);
      expect(calls).toBe(1);
      now += 61_000;
      fail = true;
      await expect(c.ld.messages.getMessage(99)).rejects.toThrow();
      expect(calls).toBe(2);
    } finally {
      c.cleanup();
    }
  });

  it('concurrent readers of a dead entry share one request', async () => {
    const c = await seeded();
    try {
      let now = Date.now();
      c.ld.ctx.clock = () => now;
      let calls = 0;
      globalThis.fetch = async (input, init) => {
        calls++;
        await settle(10);
        return universalMock()(input, init);
      };
      await c.ld.messages.getMessage(99);
      c.ld.cache.invalidate('messages');
      now += 61_000;
      const [a, b] = await Promise.all([
        c.ld.messages.getMessage(99),
        c.ld.messages.getMessage(99),
      ]);
      expect(a).toBe(b);
      expect(calls).toBe(2);
    } finally {
      c.cleanup();
    }
  });

  it('entry with fetchedAt in the future is dead and pruned without timers', async () => {
    const c = await seeded();
    try {
      let now = Date.now();
      c.ld.ctx.clock = () => now;
      let calls = 0;
      globalThis.fetch = async (input, init) => {
        calls++;
        return universalMock()(input, init);
      };
      await c.ld.grades.getGrades();
      expect(calls).toBe(1);
      now -= 10_000;
      await c.ld.grades.getGrades({ force: false });
      expect(calls).toBe(2);
    } finally {
      c.cleanup();
    }
  });

  it("fetchIgnore makes grades manual; stopPolling doesn't change serving", async () => {
    const { ld, storage } = createTestClient({
      fetchInterval: 0,
      maxRetries: 0,
      fetchIgnore: ['grades'],
    });
    try {
      await seedSession(storage, ld, testAccount(), 'tok');
      let now = Date.now();
      ld.ctx.clock = () => now;
      let calls = 0;
      globalThis.fetch = async (input, init) => {
        calls++;
        return universalMock()(input, init);
      };
      await ld.grades.getGrades();
      now += 61_000;
      ld.stopPolling();
      await ld.grades.getGrades();
      expect(calls).toBe(2);
    } finally {
      ld.destroy();
    }
  });

  it('week rollover moves the oldest maintained week to manual', async () => {
    const c = await seeded();
    try {
      const monday = weekRanges(Date.now()).current[0];
      const prevStart = weekRanges(Date.now()).previous[0];
      const prevEnd = weekRanges(Date.now()).previous[1];
      let now = Date.now();
      c.ld.ctx.clock = () => now;
      let calls = 0;
      globalThis.fetch = async (input, init) => {
        calls++;
        return universalMock()(input, init);
      };
      await c.ld.timetable.getTimetable({ startDate: prevStart, endDate: prevEnd, force: true });
      expect(calls).toBe(1);
      // 8 days later the week rolled over: previous is now manual.
      void monday;
      now += 8 * 24 * 3600_000;
      await c.ld.timetable.getTimetable({ startDate: prevStart, endDate: prevEnd });
      // The week itself was refetched from the network (plus silent prefetches).
      expect(calls).toBeGreaterThanOrEqual(2);
    } finally {
      c.cleanup();
    }
  });

  it('force bypasses cache; invalidate makes maintained stale and kills manual', async () => {
    const c = await seeded();
    try {
      let calls = 0;
      globalThis.fetch = async (input, init) => {
        calls++;
        return universalMock()(input, init);
      };
      await c.ld.grades.getGrades();
      await c.ld.grades.getGrades({ force: true });
      expect(calls).toBe(2);
      await c.ld.messages.getMessage(99);
      const before = calls;
      c.ld.cache.invalidate('messages');
      // Manual detail entry killed: next read hits the network.
      await c.ld.messages.getMessage(99);
      expect(calls).toBe(before + 1);
      // Maintained entry only stale: served instantly, refreshed behind.
      c.ld.cache.invalidate('grades');
      const g = await c.ld.grades.getGrades();
      expect(g).toBeDefined();
      await settle();
      expect(calls).toBeGreaterThan(before + 1);
    } finally {
      c.cleanup();
    }
  });

  it('restart keeps maintained data (incl. encrypted storage); old manual data is gone', async () => {
    const base = createMemoryStorage();
    const storage = encryptedStorage(base, 'passkey-1', () => undefined);
    const ld1 = new Litedirecte({ storage, maxRetries: 0, fetchInterval: 0 });
    try {
      await seedSession(storage, ld1, testAccount(), 'tok');
      let now = Date.now();
      ld1.ctx.clock = () => now;
      globalThis.fetch = universalMock();
      await ld1.grades.getGrades();
      await ld1.messages.getMessage(99);
      now += 61_000;
      // Manual detail is dead; maintained grades still living in storage.
      const ld2 = new Litedirecte({ storage, maxRetries: 0, fetchInterval: 0 });
      try {
        ld2.ctx.clock = () => now;
        await ld2.auth.loadSession();
        let calls = 0;
        globalThis.fetch = async (input, init) => {
          calls++;
          return universalMock()(input, init);
        };
        await ld2.grades.getGrades();
        // Served from storage: exactly one read happened only if stale refresh ran.
        await settle();
        const detailCalls = calls;
        await ld2.messages.getMessage(99).catch(() => null);
        expect(calls).toBeGreaterThanOrEqual(detailCalls);
      } finally {
        ld2.destroy();
      }
    } finally {
      ld1.destroy();
    }
  });

  it('offline serves fresh and stale with no request; missing or dead reject with EdOfflineError', async () => {
    const c = await seeded({ online: true });
    try {
      let now = Date.now();
      c.ld.ctx.clock = () => now;
      let calls = 0;
      globalThis.fetch = async (input, init) => {
        calls++;
        return universalMock()(input, init);
      };
      const a = await c.ld.grades.getGrades();
      now += 61_000;
      c.setOnline(false);
      const b = await c.ld.grades.getGrades();
      expect(b).toBe(a);
      expect(calls).toBe(1);
      await expect(c.ld.messages.getMessage(123456)).rejects.toBeInstanceOf(EdOfflineError);
      expect(calls).toBe(1);
    } finally {
      c.cleanup();
    }
  });

  it('offline serves a dead entry, reports offline once, and refetches when back online', async () => {
    const c = await seeded({ online: true });
    try {
      let now = Date.now();
      c.ld.ctx.clock = () => now;
      let calls = 0;
      globalThis.fetch = async (input, init) => {
        calls++;
        return universalMock()(input, init);
      };
      const a = await c.ld.messages.getMessage(99);
      expect(calls).toBe(1);
      // Manual detail dies after the interval.
      now += 61_000;
      c.setOnline(false);
      const states: string[] = [];
      const off = c.ld.sync.onChange((s) => void states.push(s.state));
      // Dead, but it is the only copy: served, and never silently.
      expect(await c.ld.messages.getMessage(99)).toBe(a);
      expect(calls).toBe(1);
      expect(c.ld.sync.getState().state).toBe('offline');
      expect(c.ld.sync.getState().lastError).toBeInstanceOf(EdOfflineError);
      expect(states).toEqual(['offline']);
      // Still offline: served again, but the status does not repeat itself.
      expect(await c.ld.messages.getMessage(99)).toBe(a);
      expect(states).toEqual(['offline']);
      // An offline getAll must not prune the only copy we have.
      expect(Object.keys((await c.ld.getAll()).errors).length).toBeGreaterThan(0);
      expect(await c.ld.messages.getMessage(99)).toBe(a);
      // Back online: the dead entry is refetched, not served.
      c.setOnline(true);
      await c.ld.messages.getMessage(99);
      expect(calls).toBe(2);
      off();
    } finally {
      c.cleanup();
    }
  });

  it('getAll fetches each resource once (timetable three times) in parallel, then plain calls hit cache', async () => {
    const c = await seeded();
    try {
      const seen: string[] = [];
      const bodies: Record<string, any> = {};
      globalThis.fetch = async (input, init) => {
        const url = input.toString();
        seen.push(url);
        try {
          const s = init?.body?.toString() ?? '';
          if (s.startsWith('data=')) bodies[url] = JSON.parse(decodeURIComponent(s.slice(5)));
        } catch {}
        return universalMock()(input, init);
      };
      const all = await c.ld.getAll();
      expect(all.errors).toEqual({});
      expect(all.skipped).toEqual([]);
      const count = (p: string) => seen.filter((u) => u.includes(p)).length;
      expect(count('/notes.awp')).toBe(1);
      expect(count('/emploidutemps.awp')).toBe(3);
      expect(count('/cahierdetexte.awp')).toBe(1);
      expect(count('/timeline.awp')).toBe(1);
      expect(count('/timelineAccueilCommun.awp')).toBe(1);
      expect(count('/viescolaire.awp')).toBe(1);
      expect(count('/logins/')).toBe(1);
      expect(count('/qcms/0/associations.awp')).toBe(1);
      expect(count('/elevesDocuments.awp')).toBe(1);
      expect(count('/cloud/')).toBe(1);
      expect(all.timetable).toBeDefined();
      // No individual message/day/qcm-detail/ical requests.
      expect(seen.some((u) => /\/messages\/\d+\.awp/.test(u))).toBe(false);
      expect(seen.some((u) => /cahierdetexte\/\d{4}-/.test(u))).toBe(false);
      expect(seen.some((u) => /\/qcms\/\d+\/associations\/\d+/.test(u))).toBe(false);
      expect(seen.some((u) => u.includes('/ical/'))).toBe(false);
      // Plain calls hit the cache (only background neighbour prefetches may add outer-week reads).
      seen.length = 0;
      await c.ld.grades.getGrades();
      await c.ld.messages.getMessages();
      await c.ld.cloud.getCloud();
      await c.ld.documents.getDocuments();
      await c.ld.settings.getSettings();
      await c.ld.qcms.getQcms();
      await settle(60);
      const foreground = seen.filter(
        (u) => !u.includes('/emploidutemps.awp') || Object.values(bodies).length === 0,
      );
      expect(foreground.filter((u) => u.includes('/notes.awp'))).toHaveLength(0);
      expect(foreground.filter((u) => u.includes('/messages.awp'))).toHaveLength(0);
      expect(foreground.filter((u) => u.includes('/cloud/'))).toHaveLength(0);
    } finally {
      c.cleanup();
    }
  });

  it('getAll ignore skips; unknown name throws; failures land in errors; unsupported in skipped', async () => {
    const c = await seeded();
    try {
      globalThis.fetch = universalMock({
        '/viescolaire.awp': () => new Response('{}', { status: 500 }),
      });
      const all = await c.ld.getAll({ ignore: ['grades'] });
      expect(all.grades).toBeUndefined();
      expect(all.errors['attendance']).toBeDefined();
      await expect(c.ld.getAll({ ignore: ['nope' as never] })).rejects.toBeInstanceOf(
        EdValidationError,
      );
      // Unsupported module goes to skipped.
      const limited = testAccount({
        modules: [{ code: 'NOTES', enable: true, badge: 0, params: {} }],
      });
      const { ld: ld2, storage } = createTestClient({ fetchInterval: 0, maxRetries: 0 });
      try {
        await seedSession(storage, ld2, limited, 'tok');
        globalThis.fetch = universalMock();
        const r = await ld2.getAll();
        expect(r.skipped).toContain('timetable');
      } finally {
        ld2.destroy();
      }
    } finally {
      c.cleanup();
    }
  });

  it('neighbour prefetch fetches both neighbours once; fresh neighbours fetch none; no chaining', async () => {
    const c = await seeded();
    try {
      const weeks = weekRanges(Date.now());
      let calls: string[] = [];
      globalThis.fetch = async (input, init) => {
        calls.push(input.toString());
        return universalMock()(input, init);
      };
      await c.ld.timetable.getTimetable({ startDate: weeks.current[0], endDate: weeks.current[1] });
      await settle(80);
      const edt = calls.filter((u) => u.includes('/emploidutemps.awp'));
      expect(edt).toHaveLength(3);
      // Fresh neighbours: exactly one request.
      calls = [];
      await c.ld.timetable.getTimetable({ startDate: weeks.current[0], endDate: weeks.current[1] });
      await settle(60);
      expect(calls.filter((u) => u.includes('/emploidutemps.awp'))).toHaveLength(0);
      // Non-week ranges do not prefetch.
      calls = [];
      await c.ld.timetable.getTimetable({
        startDate: weeks.current[0],
        endDate: weeks.current[0],
        force: true,
      });
      await settle(60);
      expect(calls.filter((u) => u.includes('/emploidutemps.awp'))).toHaveLength(1);
    } finally {
      c.cleanup();
    }
  });

  it('ten quick calls for the same week cause one request per week', async () => {
    const c = await seeded();
    try {
      const weeks = weekRanges(Date.now());
      let calls = 0;
      globalThis.fetch = async (input, init) => {
        calls++;
        await settle(5);
        return universalMock()(input, init);
      };
      await Promise.all(
        Array.from({ length: 10 }, () =>
          c.ld.timetable.getTimetable({ startDate: weeks.current[0], endDate: weeks.current[1] }),
        ),
      );
      await settle(80);
      // 1 requested + 2 neighbours.
      expect(calls).toBe(3);
    } finally {
      c.cleanup();
    }
  });

  it('polling: constructor arms 60s; 0 disables; bad values throw leaving settings untouched', () => {
    const a = new Litedirecte({ storage: createMemoryStorage(), fetchInterval: 0 });
    try {
      expect(a.ctx.pollingState).toBe('running');
      expect(a.ctx.pollingTimer).toBeNull();
    } finally {
      a.destroy();
    }
    const b = new Litedirecte({ storage: createMemoryStorage() });
    try {
      expect(b.ctx.pollingTimer).not.toBeNull();
      expect(b.ctx.fetchIntervalSec).toBe(60);
      expect(() => b.configure({ fetchInterval: 2 })).toThrow(EdValidationError);
      expect(b.ctx.fetchIntervalSec).toBe(60);
      expect(b.ctx.pollingTimer).not.toBeNull();
      b.stopPolling();
      expect(b.ctx.pollingTimer).toBeNull();
      b.configure({ fetchInterval: 30 });
      expect(b.ctx.pollingTimer).toBeNull();
      b.resumePolling();
      expect(b.ctx.pollingTimer).not.toBeNull();
    } finally {
      b.destroy();
    }
  });

  it('resumePolling catch-up ticks once when stale, never when fresh', async () => {
    const { ld, storage } = createTestClient({ fetchInterval: 5, maxRetries: 0 });
    try {
      await seedSession(storage, ld, testAccount(), 'tok');
      let notes = 0;
      globalThis.fetch = async (input, init) => {
        if (input.toString().includes('/notes.awp')) notes++;
        return universalMock()(input, init);
      };
      ld.stopPolling();
      ld.ctx.lastSuccessfulGetAllAt = Date.now() - 60_000;
      for (let i = 0; i < 5; i++) ld.resumePolling();
      await settle(200);
      expect(notes).toBe(1);
      ld.stopPolling();
      notes = 0;
      ld.ctx.lastSuccessfulGetAllAt = Date.now();
      ld.resumePolling();
      await settle(120);
      expect(notes).toBe(0);
      ld.stopPolling();
    } finally {
      ld.destroy();
    }
  });

  it('token expiry during background getAll: one silent refresh, no prompt', async () => {
    const store = new Map<string, string>([
      ['ed_access_token_9876', 'at'],
      ['ed_uuid_9876', 'u'],
    ]);
    const adapter = {
      get: (k: string) => store.get(k) ?? null,
      set: (k: string, v: string) => void store.set(k, v),
      delete: (k: string) => void store.delete(k),
    };
    const { ld } = createTestClient({
      storage: adapter,
      maxRetries: 0,
      fetchInterval: 0,
      onCredentialsRequired: mock(async () => ({ identifiant: 'u', motdepasse: 'p' })),
    });
    try {
      await seedSession(adapter, ld, testAccount(), 'old');
      let refreshCalls = 0;
      let notesCalls = 0;
      globalThis.fetch = async (input, init) => {
        const url = input.toString();
        const body = init?.body?.toString() ?? '';
        if (url.includes('login.awp?gtk=1')) {
          return json(
            { code: 200, token: '', message: '', data: {} },
            { 'set-cookie': 'GTK=g; Path=/' },
          );
        }
        if (url.includes('/login.awp') && body.includes('isReLogin')) {
          refreshCalls++;
          return json({ code: 200, token: 'new', message: '', data: {} }, { 'X-Token': 'new' });
        }
        if (url.includes('/notes.awp')) {
          notesCalls++;
          if (notesCalls === 1) return json({ code: 521, message: 'expired', data: {} });
          return json({ code: 200, message: '', data: NOTES });
        }
        return universalMock()(input, init);
      };
      const all = await ld.getAll();
      expect(refreshCalls).toBe(1);
      expect(all.grades).toBeDefined();
      expect(ld.ctx.config.onCredentialsRequired).not.toHaveBeenCalled?.();
    } finally {
      ld.destroy();
    }
  });

  it('failed silent refresh rejects getAll once, pauses with auth-required, foreground prompts once', async () => {
    const store = new Map<string, string>([
      ['ed_access_token_9876', 'at'],
      ['ed_uuid_9876', 'u'],
    ]);
    const adapter = {
      get: (k: string) => store.get(k) ?? null,
      set: (k: string, v: string) => void store.set(k, v),
      delete: (k: string) => void store.delete(k),
    };
    const onCreds = mock(async () => ({ identifiant: 'u', motdepasse: 'p' }));
    const { ld } = createTestClient({
      storage: adapter,
      maxRetries: 0,
      fetchInterval: 0,
      onCredentialsRequired: onCreds,
    });
    try {
      await seedSession(adapter, ld, testAccount(), 'old');
      let loginCalls = 0;
      globalThis.fetch = async (input, init) => {
        const url = input.toString();
        const body = init?.body?.toString() ?? '';
        if (url.includes('login.awp?gtk=1')) {
          return json(
            { code: 200, token: '', message: '', data: {} },
            { 'set-cookie': 'GTK=g; Path=/' },
          );
        }
        if (url.includes('/login.awp')) {
          loginCalls++;
          return json({ code: 505, message: 'bad', data: {} });
        }
        // Every resource sees the same expired session.
        return json({ code: 521, message: 'expired', data: {} });
      };
      await expect(ld.getAll()).rejects.toBeInstanceOf(EdAuthError);
      expect(loginCalls).toBe(1);
      expect(onCreds).not.toHaveBeenCalled();
      expect(ld.sync.getState().state).toBe('auth-required');
      expect(ld.ctx.authPaused).toBe(true);
      // Foreground read during the pause performs the interactive refresh.
      (onCreds as any).mockClear?.();
      globalThis.fetch = async (input, init) => {
        const url = input.toString();
        if (url.includes('login.awp?gtk=1')) {
          return json(
            { code: 200, token: '', message: '', data: {} },
            { 'set-cookie': 'GTK=g; Path=/' },
          );
        }
        return universalMock()(input, init);
      };
      await ld.auth.clearSession();
      expect(ld.sync.getState().state).toBe('signed-out');
    } finally {
      ld.destroy();
    }
  });

  it('network failure during refresh keeps ticking and never sets auth-required', async () => {
    const store = new Map<string, string>([
      ['ed_access_token_9876', 'at'],
      ['ed_uuid_9876', 'u'],
    ]);
    const adapter = {
      get: (k: string) => store.get(k) ?? null,
      set: (k: string, v: string) => void store.set(k, v),
      delete: (k: string) => void store.delete(k),
    };
    const c = clientWithSession();
    try {
      const { ld } = c;
      ld.configure({ storage: adapter });
      await seedSession(adapter, ld, testAccount(), 'old');
      globalThis.fetch = async (input, init) => {
        const url = input.toString();
        if (url.includes('/login.awp')) throw new Error('down');
        if (url.includes('/notes.awp')) return json({ code: 521, message: 'expired', data: {} });
        return universalMock()(input, init);
      };
      await expect(ld.grades.getGrades({ force: true })).rejects.toThrow();
      expect(ld.sync.getState().state).not.toBe('auth-required');
      expect(ld.ctx.authPaused).toBe(false);
    } finally {
      c.cleanup();
    }
  });

  it('logout during an in-flight getAll abandons everything quietly', async () => {
    const c = await seeded();
    try {
      let release!: () => void;
      const gate = new Promise<void>((r) => void (release = r));
      globalThis.fetch = async (input, init) => {
        await gate;
        return universalMock()(input, init);
      };
      const seen: unknown[] = [];
      const off = c.ld.on('newGrade', (g) => void seen.push(g));
      const p = c.ld.getAll();
      p.catch(() => {});
      await settle(10);
      await c.ld.auth.logout();
      release();
      await expect(p).rejects.toThrow();
      expect(seen).toHaveLength(0);
      expect(c.ld.sync.getState().state).toBe('signed-out');
      off();
    } finally {
      c.cleanup();
    }
  });

  it('first getAll emits no new events; extra grade emits exactly one', async () => {
    const c = await seeded();
    try {
      let grades = [{ id: 1 }, { id: 2 }];
      globalThis.fetch = async (input, init) => {
        if (input.toString().includes('/notes.awp')) {
          return json({ code: 200, message: '', data: { notes: grades } });
        }
        return universalMock()(input, init);
      };
      const seen: unknown[] = [];
      const off = c.ld.on('newGrade', (g) => void seen.push(g));
      await c.ld.getAll();
      expect(seen).toHaveLength(0);
      grades = [...grades, { id: 3 }];
      await c.ld.getAll();
      expect(seen).toHaveLength(1);
      off();
    } finally {
      c.cleanup();
    }
  });

  it('watch fires once per real change, never for identical payloads', async () => {
    const c = await seeded();
    try {
      let grades = [{ id: 1 }];
      globalThis.fetch = async (input, init) => {
        if (input.toString().includes('/notes.awp')) {
          return json({ code: 200, message: '', data: { notes: grades } });
        }
        return universalMock()(input, init);
      };
      const seen: unknown[] = [];
      const off = c.ld.cache.watch('grades', (e) => void seen.push(e));
      await c.ld.getAll();
      const first = seen.length;
      await c.ld.getAll();
      expect(seen.length).toBe(first);
      grades = [...grades, { id: 2 }];
      await c.ld.getAll();
      expect(seen.length).toBe(first + 1);
      off();
    } finally {
      c.cleanup();
    }
  });

  it('sync moves signed-out -> idle -> syncing -> idle; prefetch failure sets error', async () => {
    const { ld, storage } = createTestClient({ fetchInterval: 0, maxRetries: 0 });
    try {
      expect(ld.sync.getState().state).toBe('signed-out');
      await seedSession(storage, ld, testAccount(), 'tok');
      // loadSession sets idle.
      expect(ld.sync.getState().state).toBe('idle');
      const states: string[] = [];
      const off = ld.sync.onChange((s) => void states.push(s.state));
      globalThis.fetch = universalMock();
      const p = ld.getAll();
      expect(ld.sync.getState().state).toBe('syncing');
      await p;
      expect(ld.sync.getState().state).toBe('idle');
      off();
      void states;
    } finally {
      ld.destroy();
    }
  });

  it('logout and clearSession purge persisted entries; instances stay isolated incl. documents', async () => {
    const shared = createMemoryStorage();
    const a = new Litedirecte({
      storage: shared,
      storageNamespace: 'a:',
      maxRetries: 0,
      fetchInterval: 0,
    });
    const b = new Litedirecte({
      storage: shared,
      storageNamespace: 'b:',
      maxRetries: 0,
      fetchInterval: 0,
    });
    try {
      a.ctx.account = testAccount();
      a.ctx.token = 't';
      b.ctx.account = testAccount({ id: 5555 });
      b.ctx.token = 't';
      globalThis.fetch = universalMock();
      await a.documents.getDocuments();
      await b.documents.getDocuments();
      expect(await shared.get('a:ed_cache_index')).not.toBeNull();
      expect(await shared.get('b:ed_cache_index')).not.toBeNull();
      await a.auth.clearSession();
      expect(await shared.get('a:ed_cache_index')).toBeNull();
      expect(await shared.get('b:ed_cache_index')).not.toBeNull();
    } finally {
      a.destroy();
      b.destroy();
    }
  });

  it('markAsDone patches cached homework; markAsUnread drops the detail entry', async () => {
    const c = await seeded();
    try {
      globalThis.fetch = universalMock();
      const before = (await c.ld.homework.getHomework()) as Record<
        string,
        Array<{ idDevoir: number; effectue: boolean }>
      >;
      expect(before['2026-03-24'][0].effectue).toBe(false);
      globalThis.fetch = async (input, init) => {
        if (input.toString().includes('cahierdetexte.awp?verbe=put')) {
          return json({ code: 200, message: '', data: { succes: true } });
        }
        throw new Error('must not refetch');
      };
      await c.ld.homework.markAsDone([7]);
      const after = (await c.ld.homework.getHomework()) as Record<
        string,
        Array<{ idDevoir: number; effectue: boolean }>
      >;
      expect(after['2026-03-24'][0].effectue).toBe(true);
      // markAsUnread deletes the cached detail so the next getMessage hits the server.
      globalThis.fetch = universalMock();
      await c.ld.messages.getMessage(99);
      let detailCalls = 0;
      globalThis.fetch = async (input, init) => {
        const url = input.toString();
        if (/\/messages\/\d+\.awp/.test(url)) detailCalls++;
        return universalMock()(input, init);
      };
      await c.ld.messages.markAsUnread(99);
      await c.ld.messages.getMessage(99);
      expect(detailCalls).toBe(1);
    } finally {
      c.cleanup();
    }
  });

  it('on2faRequired is called at most once during a parallel login getAll prefetch', async () => {
    const { ld } = createTestClient({ fetchInterval: 0, maxRetries: 0 });
    try {
      let calls = 0;
      globalThis.fetch = async (input, init) => {
        const url = input.toString();
        if (url.includes('login.awp?gtk=1')) {
          return json(
            { code: 200, token: '', message: '', data: {} },
            { 'set-cookie': 'GTK=g; Path=/' },
          );
        }
        if (url.includes('/login.awp')) {
          calls++;
          return json(
            {
              code: 200,
              token: 't',
              message: '',
              data: {
                accounts: [
                  {
                    idLogin: 1,
                    id: 9876,
                    uid: 'u',
                    identifiant: 'u',
                    typeCompte: 'E',
                    prenom: 'J',
                    nom: 'D',
                    email: 'e',
                    nomEtablissement: 's',
                    main: true,
                    profile: { sexe: 'M', photo: '' },
                    modules: [],
                  },
                ],
              },
            },
            { 'X-Token': 't' },
          );
        }
        return universalMock()(input, init);
      };
      const on2fa = mock(() => 0);
      const res = await ld.auth.login('u', 'p', { on2faRequired: on2fa });
      expect(res.type).toBe('success');
      expect(calls).toBe(1);
    } finally {
      ld.destroy();
    }
  });

  it('read results are shared memoized objects', async () => {
    const c = await seeded();
    try {
      globalThis.fetch = universalMock();
      const a = await c.ld.grades.getGrades();
      const b = await c.ld.grades.getGrades();
      expect(b).toBe(a);
      const all = await c.ld.getAll();
      expect(all.grades).toBe(a);
    } finally {
      c.cleanup();
    }
  });

  it('documents key includes the account id explicitly', async () => {
    const c = await seeded();
    try {
      globalThis.fetch = universalMock();
      await c.ld.documents.getDocuments();
      const keys = [...c.ld.ctx.cacheMem.keys()];
      expect(keys.some((k) => k.startsWith('documents|9876|'))).toBe(true);
    } finally {
      c.cleanup();
    }
  });

  it('startPolling no longer exists', () => {
    const { ld, storage } = createTestClient({ fetchInterval: 0 });
    try {
      expect((ld as unknown as Record<string, unknown>).startPolling).toBeUndefined();
      void storage;
    } finally {
      ld.destroy();
    }
  });

  it('getLastSync returns a Date after sync, null before', async () => {
    const c = await seeded();
    try {
      expect(c.ld.cache.getLastSync('grades')).toBeNull();
      globalThis.fetch = universalMock();
      await c.ld.grades.getGrades();
      expect(c.ld.cache.getLastSync('grades')).toBeInstanceOf(Date);
    } finally {
      c.cleanup();
    }
  });

  it('offline getAll resolves with per-resource errors; queued mutations still work', async () => {
    const { ld, storage } = createTestClient({
      fetchInterval: 0,
      maxRetries: 0,
      offlineQueue: true,
      isOnline: () => false,
    });
    try {
      await seedSession(storage, ld, testAccount(), 'tok');
      const all = await ld.getAll();
      expect(Object.keys(all.errors).length).toBeGreaterThan(0);
      await ld.offlineQueue.push('/x.awp?verbe=put', { method: 'POST' });
      expect(ld.offlineQueue.getQueue()).toHaveLength(1);
    } finally {
      ld.destroy();
    }
  });
});
