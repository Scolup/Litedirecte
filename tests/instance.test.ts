// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { Litedirecte, ED_MODULES, createMemoryStorage } from '../src/index';
import { createTestClient, seedSession, testAccount } from './setup';
import { EdUnsupportedModuleError, EdValidationError } from '../src/core/errors';

function json(body: any, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** Auto-advancing fake clock: manual offset on top of real elapsed time. */
function autoClock() {
  const realStart = Date.now();
  let offset = 0;
  return {
    now: () => offset + (Date.now() - realStart),
    advance: (ms: number) => {
      offset += ms;
    },
  };
}

const rawAccount = (overrides: Record<string, unknown> = {}) => ({
  idLogin: 1234567,
  id: 9876,
  uid: 'session_uid',
  identifiant: 'Test.user',
  typeCompte: 'E',
  prenom: 'John',
  nom: 'Doe',
  email: 'john.doe@example.com',
  nomEtablissement: 'Ecole Test',
  main: true,
  accesstoken: 'mocked_access_token',
  photo: 'https://example.com/photo.jpg',
  profile: { sexe: 'M', photo: 'https://example.com/photo.jpg' },
  modules: [{ code: 'NOTES', enable: 1, badge: 0, params: {} }],
  ...overrides,
});

describe('Instance API', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('namespaces', () => {
    it('exposes every method on the right namespace and destructured methods work', async () => {
      const { ld, storage } = createTestClient();
      try {
        await seedSession(storage, ld, testAccount(), 'tok');
        const seen: string[] = [];
        globalThis.fetch = async (input) => {
          seen.push(input.toString());
          return json({ code: 200, message: '', data: {} });
        };
        const expected: [object, string[]][] = [
          [
            ld.auth,
            [
              'login',
              'logout',
              'refreshToken',
              'loadSession',
              'clearSession',
              'getAccount',
              'getAccounts',
              'switchAccount',
              'getLastTokenRefresh',
              'checkTokenHealth',
              'startTokenKeepalive',
              'stopTokenKeepalive',
            ],
          ],
          [ld.grades, ['getGrades', 'correlate']],
          [ld.timetable, ['getTimetable', 'getTimetableIcalUrl']],
          [
            ld.homework,
            [
              'getHomework',
              'getHomeworkForDate',
              'markAsDone',
              'markAsUndone',
              'sendHomeworkComment',
            ],
          ],
          [
            ld.messages,
            [
              'getMessages',
              'getMessage',
              'getContacts',
              'sendMessage',
              'uploadAttachment',
              'markAsRead',
              'markAsUnread',
            ],
          ],
          [ld.timeline, ['getTimeline', 'getCommonTimeline']],
          [ld.attendance, ['getAttendance']],
          [ld.cloud, ['getCloud', 'createFolder', 'deleteNodes']],
          [ld.documents, ['getDocuments']],
          [ld.qcms, ['getQcms', 'getQcmDetail', 'updateQcmStatus', 'submitQcmAnswer']],
          [ld.settings, ['getSettings', 'updateSettings', 'updateAccessibility']],
          [ld.downloads, ['download', 'downloadPhoto']],
          [ld.offlineQueue, ['push', 'flush', 'getQueue', 'clear']],
        ];
        for (const [ns, methods] of expected) {
          for (const m of methods) {
            expect(typeof (ns as any)[m], `${m}`).toBe('function');
          }
        }
        // Destructured methods keep working (arrow properties bound to the instance).
        const { getGrades } = ld.grades;
        const { getMessages } = ld.messages;
        await getGrades();
        await getMessages();
        expect(seen.some((u) => u.includes('/notes.awp'))).toBe(true);
        expect(seen.some((u) => u.includes('/messages.awp'))).toBe(true);
      } finally {
        ld.destroy();
      }
    });
  });

  describe('isolation', () => {
    it('two instances send their own tokens and never see each other', async () => {
      const a = createTestClient();
      const b = createTestClient();
      try {
        await seedSession(a.storage, a.ld, testAccount(), 'token-a');
        await seedSession(
          b.storage,
          b.ld,
          testAccount({ id: 5555, identifiant: 'Other.user' }),
          'token-b',
        );
        const tokens: string[] = [];
        globalThis.fetch = async (_input, init) => {
          const h = new Headers(init?.headers);
          tokens.push(h.get('X-Token') ?? '');
          return json({ code: 200, message: '', data: { notes: [] } });
        };
        await a.ld.grades.getGrades();
        await b.ld.grades.getGrades();
        expect(tokens).toEqual(['token-a', 'token-b']);
        expect(a.ld.auth.getAccount()?.identifiant).toBe('Test.user');
        expect(b.ld.auth.getAccount()?.identifiant).toBe('Other.user');
      } finally {
        a.ld.destroy();
        b.ld.destroy();
      }
    });

    it('logout on one instance leaves the other logged in', async () => {
      const a = createTestClient();
      const b = createTestClient();
      try {
        await seedSession(a.storage, a.ld, testAccount(), 'token-a');
        await seedSession(b.storage, b.ld, testAccount(), 'token-b');
        await a.ld.auth.logout();
        expect(a.ld.auth.getAccount()).toBeUndefined();
        expect(b.ld.auth.getAccount()?.identifiant).toBe('Test.user');
        expect(b.ld.ctx.token).toBe('token-b');
      } finally {
        a.ld.destroy();
        b.ld.destroy();
      }
    });

    it('event listeners, polling timers and queues are per instance', async () => {
      const a = createTestClient();
      const b = createTestClient();
      try {
        await seedSession(a.storage, a.ld, testAccount(), 'tok');
        await seedSession(b.storage, b.ld, testAccount(), 'tok');
        globalThis.fetch = async () =>
          json({ code: 200, message: '', data: { notes: [], messages: { received: [] } } });
        const seenA: unknown[] = [];
        const seenB: unknown[] = [];
        a.ld.on('newGrade', (g) => void seenA.push(g));
        b.ld.on('newGrade', (g) => void seenB.push(g));
        a.ld.ctx.emitter.emit('newGrade', { id: 1 });
        expect(seenA).toHaveLength(1);
        expect(seenB).toHaveLength(0);

        // Polling is armed at construction, per instance.
        expect(a.ld.ctx.pollingTimer).not.toBeNull();
        expect(b.ld.ctx.pollingTimer).not.toBeNull();
        a.ld.stopPolling();
        expect(a.ld.ctx.pollingTimer).toBeNull();
        expect(b.ld.ctx.pollingTimer).not.toBeNull();
        a.ld.resumePolling();

        await a.ld.offlineQueue.push('/a.awp?verbe=put', { method: 'POST' });
        expect(a.ld.offlineQueue.getQueue()).toHaveLength(1);
        expect(b.ld.offlineQueue.getQueue()).toHaveLength(0);
        expect(a.ld.ctx.queue).not.toBe(b.ld.ctx.queue);
        expect(a.ld.ctx.emitter).not.toBe(b.ld.ctx.emitter);
      } finally {
        a.ld.destroy();
        b.ld.destroy();
      }
    });

    it('two instances sharing one adapter with different storageNamespace do not overwrite each other', async () => {
      const shared = createMemoryStorage();
      const a = new Litedirecte({ storage: shared, storageNamespace: 'a:', maxRetries: 0 });
      const b = new Litedirecte({ storage: shared, storageNamespace: 'b:', maxRetries: 0 });
      try {
        a.ctx.token = 'token-a';
        a.ctx.account = testAccount();
        const { persistSession } = await import('../src/core/store');
        await persistSession(a.ctx);
        expect(await shared.get('a:ed_tk')).toBe('token-a');
        expect(await shared.get('b:ed_tk')).toBeNull();
        expect(await shared.get('ed_tk')).toBeNull();

        const b2 = new Litedirecte({ storage: shared, storageNamespace: 'b:', maxRetries: 0 });
        try {
          expect(await b2.auth.loadSession()).toBe(false);
        } finally {
          b2.destroy();
        }
        const a2 = new Litedirecte({ storage: shared, storageNamespace: 'a:', maxRetries: 0 });
        try {
          expect(await a2.auth.loadSession()).toBe(true);
          expect(a2.auth.getAccount()?.identifiant).toBe('Test.user');
        } finally {
          a2.destroy();
        }
        expect(await b.auth.loadSession()).toBe(false);
      } finally {
        a.destroy();
        b.destroy();
      }
    });
  });

  describe('constructor', () => {
    it('performs no I/O: no fetch and no storage access', async () => {
      const calls: string[] = [];
      const spy = {
        get: (k: string) => {
          calls.push(`get:${k}`);
          return null;
        },
        set: (k: string, _v: string) => {
          calls.push(`set:${k}`);
        },
        delete: (k: string) => {
          calls.push(`delete:${k}`);
        },
      };
      let fetches = 0;
      globalThis.fetch = async () => {
        fetches++;
        return json({});
      };
      const ld = new Litedirecte({ storage: spy, maxRetries: 2 });
      try {
        expect(calls).toEqual([]);
        expect(fetches).toBe(0);
        expect(ld.auth.getAccount()).toBeUndefined();
      } finally {
        ld.destroy();
      }
    });

    it('validates its config exactly like configure()', () => {
      expect(() => new Litedirecte({ concurrency: 0 })).toThrow(EdValidationError);
      expect(() => new Litedirecte({ maxRequestsPerMinute: -1 })).toThrow(EdValidationError);
      expect(() => new Litedirecte({ storageNamespace: 'bad ns' })).toThrow(EdValidationError);
      const ld = new Litedirecte({ maxRetries: 2 });
      try {
        expect(() => ld.configure({ concurrency: 0 })).toThrow(EdValidationError);
      } finally {
        ld.destroy();
      }
    });
  });

  describe('no module-level mutable state', () => {
    it('scans src/ and fails on top-level let, Map/Set, setInterval or exported mutable bindings', async () => {
      const { Glob } = await import('bun');
      const glob = new Glob('src/**/*.ts');
      // Allowlist: stateless memoization / helpers in env.ts only.
      const allowed = new Set([
        'src/core/env.ts:let _polyfill',
        'src/core/env.ts:fallbackTimers',
        'src/core/env.ts:setInterval',
      ]);
      const problems: string[] = [];
      for await (const file of glob.scan({ cwd: process.cwd() })) {
        const text = await Bun.file(file).text();
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const loc = `${file}:${i + 1}`;
          if (/^(export\s+)?let\s/.test(line) && !allowed.has(`${file}:let _polyfill`)) {
            if (file === 'src/core/env.ts' && line.includes('_polyfill')) continue;
            problems.push(`${loc}: top-level let: ${line.trim()}`);
          }
          if (/^export\s+(let|var)\s/.test(line))
            problems.push(`${loc}: exported mutable: ${line.trim()}`);
          if (/^const\s+\w+\s*=\s*new\s+(Map|Set|WeakMap)\s*\(/.test(line)) {
            if (allowed.has(`${file}:fallbackTimers`)) continue;
            problems.push(`${loc}: top-level mutable collection: ${line.trim()}`);
          }
          if (/(^|[^a-zA-Z.])setInterval\s*\(/.test(line) && file !== 'src/core/env.ts') {
            problems.push(`${loc}: raw setInterval outside env.ts: ${line.trim()}`);
          }
        }
      }
      expect(problems).toEqual([]);
    });
  });

  describe('destroy()', () => {
    it('clears timers and listeners, is idempotent, and poisons later use', async () => {
      const { ld, storage } = createTestClient({ offlineQueue: true });
      try {
        await seedSession(storage, ld, testAccount(), 'tok');
        ld.on('newGrade', () => {});
        expect(ld.ctx.pollingTimer).not.toBeNull();
        expect(ld.ctx.keepaliveTimer).not.toBeNull();
        expect(ld.ctx.onlineHandler).not.toBeNull();

        ld.destroy();
        expect(ld.ctx.pollingTimer).toBeNull();
        expect(ld.ctx.keepaliveTimer).toBeNull();
        expect(ld.ctx.onlineHandler).toBeNull();
        expect(ld.ctx.emitter.listenerCount()).toBe(0);
        expect(ld.ctx.rate.timer).toBeUndefined();

        expect(() => ld.destroy()).not.toThrow();
        await expect(ld.grades.getGrades()).rejects.toThrow('Instance destroyed');
        await expect(ld.auth.login('u', 'p')).rejects.toThrow('Instance destroyed');
        expect(() => ld.configure({})).toThrow('Instance destroyed');
        expect(() => ld.on('x', () => {})).toThrow('Instance destroyed');
      } finally {
        ld.destroy();
      }
    });

    it('rejects queued rate-limited requests', async () => {
      const { ld, storage } = createTestClient({ maxRequestsPerMinute: 1 });
      try {
        await seedSession(storage, ld, testAccount(), 'tok');
        const clock = autoClock();
        ld.ctx.clock = clock.now;
        globalThis.fetch = async () => json({ code: 200, message: '', data: { notes: [] } });
        await ld.grades.getGrades({ force: true });
        const pending = ld.grades.getGrades({ force: true });
        pending.catch(() => {});
        expect(ld.ctx.rate.waiters).toHaveLength(1);
        ld.destroy();
        // Settled by destroy: asserting on an already-rejected promise.
        await expect(pending).rejects.toThrow('Instance destroyed');
      } finally {
        ld.destroy();
      }
    });
  });

  describe('login signature', () => {
    it('rejects the old object form and aliases without any request', async () => {
      const { ld } = createTestClient();
      try {
        let calls = 0;
        globalThis.fetch = async () => {
          calls++;
          return json({});
        };
        await expect(ld.auth.login({ identifiant: 'u', motdepasse: 'p' } as any)).rejects.toThrow();
        await expect(ld.auth.login({ username: 'u', password: 'p' } as any)).rejects.toThrow();
        await expect(ld.auth.login({ identifier: 'u', motdepasse: 'p' } as any)).rejects.toThrow();
        expect(calls).toBe(0);
      } finally {
        ld.destroy();
      }
    });
  });

  describe('onError', () => {
    it('is called with a single argument', async () => {
      const seen: unknown[][] = [];
      const { ld, storage } = createTestClient({
        maxRetries: 1,
        retryDelay: 1,
        onError: mock((...args: unknown[]) => void seen.push(args)),
      });
      try {
        await seedSession(storage, ld, testAccount(), 'tok');
        let calls = 0;
        globalThis.fetch = async () => {
          calls++;
          if (calls === 1) return new Response('{}', { status: 500 });
          return json({ code: 200, message: '', data: { notes: [] } });
        };
        await ld.grades.getGrades();
        expect(seen).toHaveLength(1);
        expect(seen[0]).toHaveLength(1);
      } finally {
        ld.destroy();
      }
    });
  });

  describe('module checks', () => {
    it('ED_MODULES maps friendly names to verified codes', () => {
      expect(ED_MODULES).toEqual({
        grades: 'NOTES',
        timetable: 'EDT',
        homework: 'CAHIER_DE_TEXTES',
        attendance: 'VIE_SCOLAIRE',
      });
    });

    it('rejects without NOTES with zero network requests', async () => {
      const { ld, storage } = createTestClient({ maxRetries: 3, retryDelay: 1 });
      try {
        await seedSession(
          storage,
          ld,
          testAccount({ modules: [{ code: 'EDT', enable: true, badge: 0, params: {} }] }),
          'tok',
        );
        let calls = 0;
        globalThis.fetch = async () => {
          calls++;
          return json({ code: 200, message: '', data: {} });
        };
        const err = await ld.grades.getGrades().catch((e) => e);
        expect(err).toBeInstanceOf(EdUnsupportedModuleError);
        expect(err.module).toBe('NOTES');
        expect(calls).toBe(0);
      } finally {
        ld.destroy();
      }
    });

    it('treats enable:false as unsupported and missing/empty modules as allowed', async () => {
      const { ld, storage } = createTestClient();
      try {
        globalThis.fetch = async () => json({ code: 200, message: '', data: { notes: [] } });
        await seedSession(
          storage,
          ld,
          testAccount({ modules: [{ code: 'NOTES', enable: false, badge: 0, params: {} }] }),
          'tok',
        );
        await expect(ld.grades.getGrades()).rejects.toBeInstanceOf(EdUnsupportedModuleError);

        await seedSession(storage, ld, testAccount({ modules: [] }), 'tok');
        await expect(ld.grades.getGrades()).resolves.toBeDefined();

        const noModules = testAccount();
        delete (noModules as any).modules;
        await seedSession(storage, ld, noModules, 'tok');
        await expect(ld.grades.getGrades()).resolves.toBeDefined();
      } finally {
        ld.destroy();
      }
    });

    it('skips the check in mockMode', async () => {
      const { ld, storage } = createTestClient();
      try {
        await seedSession(
          storage,
          ld,
          testAccount({ modules: [{ code: 'OTHER', enable: true, badge: 0, params: {} }] }),
          'tok',
        );
        await expect(ld.grades.getGrades({ mockMode: true })).resolves.toBeDefined();
        await expect(ld.timetable.getTimetable({ mockMode: true })).resolves.toBeDefined();
        await expect(ld.homework.getHomework({ mockMode: true })).resolves.toBeDefined();
        await expect(ld.attendance.getAttendance({ mockMode: true })).resolves.toBeDefined();
      } finally {
        ld.destroy();
      }
    });

    it('supports() and capabilities() follow switchAccount', async () => {
      const { ld, storage } = createTestClient();
      try {
        const full = testAccount();
        const noNotes = testAccount({
          id: 5555,
          identifiant: 'Other.user',
          main: false,
          modules: [{ code: 'EDT', enable: true, badge: 0, params: {} }],
        });
        await storage.set('ed_tk', 'tok');
        await storage.set('ed_acc', JSON.stringify(full));
        await storage.set('ed_accs', JSON.stringify([full, noNotes]));
        await ld.auth.loadSession();
        expect(ld.supports('grades')).toBe(true);
        expect(ld.supports('messages')).toBe(true);
        expect(ld.capabilities()).toEqual({
          grades: true,
          timetable: true,
          homework: true,
          attendance: true,
        });
        await ld.auth.switchAccount(5555);
        expect(ld.supports('grades')).toBe(false);
        expect(ld.supports('timetable')).toBe(true);
        expect(ld.capabilities().grades).toBe(false);
      } finally {
        ld.destroy();
      }
    });
  });

  describe('rate limit', () => {
    it('lets N requests through, then waits sliding-window FIFO without dropping', async () => {
      const { ld, storage } = createTestClient({ maxRequestsPerMinute: 3 });
      try {
        await seedSession(storage, ld, testAccount(), 'tok');
        const clock = autoClock();
        ld.ctx.clock = clock.now;
        const calls: number[] = [];
        const urls: string[] = [];
        globalThis.fetch = async (input) => {
          calls.push(clock.now());
          urls.push(input.toString());
          return json({ code: 200, message: '', data: { notes: [] } });
        };
        await ld.grades.getGrades({ force: true });
        await ld.grades.getGrades({ force: true });
        await ld.grades.getGrades({ force: true });
        expect(calls).toHaveLength(3);

        clock.advance(59_900);
        const t0 = Date.now();
        const p1 = ld.grades.getGrades({ force: true });
        const p2 = ld.timetable.getTimetable({ force: true });
        await Promise.all([p1, p2]);
        const elapsed = Date.now() - t0;
        expect(calls).toHaveLength(5);
        // Waited only for the first slot to age out (~100ms), not a full window.
        expect(elapsed).toBeLessThan(5000);
        expect(calls[3] - calls[0]).toBeGreaterThanOrEqual(59_000);
        // FIFO: the grades request queued first starts first.
        expect(urls[3]).toContain('/notes.awp');
        expect(urls[4]).toContain('/emploidutemps.awp');
        // After the queue drains nothing remains scheduled.
        expect(ld.ctx.rate.timer).toBeUndefined();
        expect(ld.ctx.rate.waiters).toHaveLength(0);
      } finally {
        ld.destroy();
      }
    });

    it('counts retries against the budget', async () => {
      const { ld, storage } = createTestClient({
        maxRequestsPerMinute: 2,
        maxRetries: 1,
        retryDelay: 1,
      });
      try {
        await seedSession(storage, ld, testAccount(), 'tok');
        const clock = autoClock();
        ld.ctx.clock = clock.now;
        let calls = 0;
        globalThis.fetch = async () => {
          calls++;
          if (calls === 1) return new Response('{}', { status: 500 });
          return json({ code: 200, message: '', data: { notes: [] } });
        };
        await ld.grades.getGrades();
        expect(calls).toBe(2);
        expect(ld.ctx.rate.hits).toHaveLength(2);
      } finally {
        ld.destroy();
      }
    });

    it('does not delay login while the budget is full (login counts but never waits)', async () => {
      const { ld, storage } = createTestClient({ maxRequestsPerMinute: 1 });
      try {
        await seedSession(storage, ld, testAccount(), 'tok');
        globalThis.fetch = async (input) => {
          const url = input.toString();
          if (url.includes('login.awp?gtk=1')) {
            return json(
              { code: 200, token: '', message: '', data: {} },
              { 'set-cookie': 'GTK=g; Path=/' },
            );
          }
          if (url.includes('/login.awp')) {
            return json(
              { code: 200, token: 't', message: '', data: { accounts: [rawAccount()] } },
              { 'X-Token': 't' },
            );
          }
          return json({ code: 200, message: '', data: { notes: [] } });
        };
        await ld.grades.getGrades();
        expect(ld.ctx.rate.hits).toHaveLength(1);
        const t0 = Date.now();
        const result = await ld.auth.login('u', 'p');
        expect(Date.now() - t0).toBeLessThan(2000);
        expect(result.type).toBe('success');
        // Login and its GTK fetch counted against the budget without waiting.
        expect(ld.ctx.rate.hits.length).toBeGreaterThanOrEqual(3);
      } finally {
        ld.destroy();
      }
    });

    it('does not delay token refresh', async () => {
      const { ld, storage } = createTestClient({ maxRequestsPerMinute: 3, maxRetries: 0 });
      try {
        await storage.set('ed_access_token_9876', 'saved_access_token');
        await storage.set('ed_uuid_9876', 'saved_uuid');
        await seedSession(storage, ld, testAccount(), 'old_token');
        const clock = autoClock();
        ld.ctx.clock = clock.now;
        const times: Record<string, number> = {};
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
            times.refresh = clock.now();
            // Let 60 s pass on the fake clock so the final retry finds a free
            // slot immediately; the point under test is the refresh itself.
            clock.advance(61_000);
            return json({ code: 200, token: 'new', message: '', data: {} }, { 'X-Token': 'new' });
          }
          if (url.includes('/notes.awp')) {
            notesCalls++;
            if (notesCalls === 4) {
              times.expired = clock.now();
              return json({ code: 521, message: 'expired', data: {} });
            }
            times.notesRetry = clock.now();
            return json({ code: 200, message: '', data: { notes: [] } });
          }
          return json({ code: 200, message: '', data: {} });
        };
        await ld.grades.getGrades({ force: true });
        await ld.grades.getGrades({ force: true });
        await ld.grades.getGrades({ force: true });
        clock.advance(59_900);
        const t0 = Date.now();
        await ld.grades.getGrades({ force: true });
        // The refresh requests went out right after the expiry despite the full budget.
        expect(times.refresh - times.expired).toBeLessThan(5000);
        expect(times.notesRetry - times.refresh).toBeGreaterThanOrEqual(0);
        expect(Date.now() - t0).toBeLessThan(5000);
      } finally {
        ld.destroy();
      }
    });

    it('0 disables the limit, invalid values throw, budgets are independent', async () => {
      expect(() => new Litedirecte({ maxRequestsPerMinute: -1 })).toThrow(EdValidationError);
      expect(() => new Litedirecte({ maxRequestsPerMinute: 1.5 })).toThrow(EdValidationError);
      const a = createTestClient({ maxRequestsPerMinute: 1 });
      const free = createTestClient({ maxRequestsPerMinute: 0 });
      try {
        await seedSession(a.storage, a.ld, testAccount(), 'tok');
        await seedSession(free.storage, free.ld, testAccount(), 'tok');
        globalThis.fetch = async () => json({ code: 200, message: '', data: { notes: [] } });
        expect(() => a.ld.configure({ maxRequestsPerMinute: -2 })).toThrow(EdValidationError);
        await a.ld.grades.getGrades({ force: true });
        // a's budget is spent but free (limit 0) and a fresh instance are unaffected.
        const t0 = Date.now();
        await free.ld.grades.getGrades({ force: true });
        await free.ld.grades.getGrades({ force: true });
        await free.ld.grades.getGrades({ force: true });
        expect(Date.now() - t0).toBeLessThan(2000);
        expect(a.ld.ctx.rate.hits).toHaveLength(1);
        expect(free.ld.ctx.rate.hits).toHaveLength(0);
      } finally {
        a.ld.destroy();
        free.ld.destroy();
      }
    });

    it('unrefs its timer so it never keeps the process alive', async () => {
      const { ld, storage } = createTestClient({ maxRequestsPerMinute: 1 });
      try {
        await seedSession(storage, ld, testAccount(), 'tok');
        const clock = autoClock();
        ld.ctx.clock = clock.now;
        globalThis.fetch = async () => json({ code: 200, message: '', data: { notes: [] } });
        await ld.grades.getGrades({ force: true });
        const pending = ld.grades.getGrades({ force: true }).catch(() => {});
        expect(ld.ctx.rate.timer).toBeDefined();
        expect(typeof (ld.ctx.rate.timer as any)?.unref).toBe('function');
        ld.destroy();
        await pending;
        expect(ld.ctx.rate.timer).toBeUndefined();
      } finally {
        ld.destroy();
      }
    });
  });
});
