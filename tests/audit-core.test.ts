// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Litedirecte } from '../src/index';
import { createTestClient } from './setup';
import {
  EdAuthError,
  EdError,
  EdParseError,
  EdRateLimitError,
  EdTimeoutError,
  EdValidationError,
} from '../src/core/errors';

function mapAdapter(store: Map<string, string>) {
  return {
    get: (k: string) => store.get(k) ?? null,
    set: (k: string, v: string) => void store.set(k, v),
    delete: (k: string) => void store.delete(k),
  };
}

const auditAccount = {
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
  profile: { sexe: 'M', photo: '' },
  modules: [],
} as any;

function json(body: any, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('Audit fixes (core)', () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchCalls = 0;
  let ld: Litedirecte;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchCalls = 0;
    ({ ld } = createTestClient({ storage: mapAdapter(new Map()) }));
    ld.ctx.account = auditAccount;
    ld.ctx.token = 'test_token';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    ld.destroy();
  });

  it('A1: one failed mutation is queued exactly once with maxRetries 3', async () => {
    const store = new Map<string, string>();
    ld.configure({ storage: mapAdapter(store), offlineQueue: true, maxRetries: 3, retryDelay: 1 });
    globalThis.fetch = async () => {
      fetchCalls++;
      throw new Error('offline');
    };
    const { edFetch } = await import('../src/core/fetch');
    await expect(
      edFetch(ld.ctx, '/some-mutation.awp', { method: 'POST', queued: true, body: { x: 1 } }),
    ).rejects.toThrow();
    expect(ld.offlineQueue.getQueue().length).toBe(1);

    // skipQueue never queues, even on final failure.
    await expect(
      edFetch(ld.ctx, '/other-mutation.awp', { method: 'POST', queued: true, skipQueue: true }),
    ).rejects.toThrow();
    expect(ld.offlineQueue.getQueue().length).toBe(1);
  });

  it('A1: timeouts are not queued (server may have processed them)', async () => {
    const store = new Map<string, string>();
    ld.configure({ storage: mapAdapter(store), offlineQueue: true, maxRetries: 0 });
    globalThis.fetch = async () => {
      const err = new Error('timed out');
      err.name = 'TimeoutError';
      throw err;
    };
    const { edFetch } = await import('../src/core/fetch');
    await expect(
      edFetch(ld.ctx, '/some-mutation.awp', { method: 'POST', queued: true }),
    ).rejects.toBeInstanceOf(EdTimeoutError);
    expect(ld.offlineQueue.getQueue().length).toBe(0);
  });

  it('A2: mutations are not retried, except after 429; reads keep retries', async () => {
    // One sendMessage against a failing fetch makes exactly 1 POST.
    globalThis.fetch = async () => {
      fetchCalls++;
      throw new Error('offline');
    };
    await expect(
      ld.messages.sendMessage({ subject: 's', content: 'c', destinataires: [{ id: 1 }] }),
    ).rejects.toThrow();
    expect(fetchCalls).toBe(1);

    // A 429 on a mutation is retried.
    fetchCalls = 0;
    ld.configure({ maxRetries: 3, retryDelay: 1 });
    globalThis.fetch = async () => {
      fetchCalls++;
      if (fetchCalls === 1) return new Response('{}', { status: 429 });
      return json({ code: 200, message: '', data: { success: true } });
    };
    const res = await ld.messages.sendMessage({
      subject: 's',
      content: 'c',
      destinataires: [{ id: 1 }],
    });
    expect(res.success).toBe(true);
    expect(fetchCalls).toBe(2);

    // A read is still retried (1 initial + 3 retries).
    fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls++;
      throw new Error('offline');
    };
    await expect(ld.grades.getGrades()).rejects.toThrow();
    expect(fetchCalls).toBe(4);
  });

  it('A7: two parallel expired reads cause exactly 1 refresh', async () => {
    const store = new Map<string, string>([
      ['ed_access_token_9876', 'saved_access_token'],
      ['ed_uuid_9876', 'saved_uuid'],
    ]);
    ld.configure({ storage: mapAdapter(store), maxRetries: 0 });
    ld.ctx.token = 'old_token';
    let notesCalls = 0;
    let refreshCalls = 0;
    globalThis.fetch = async (input, init) => {
      const url = input.toString();
      const body = init?.body?.toString() ?? '';
      if (url.includes('login.awp?gtk=1')) {
        return json(
          { code: 200, token: '', message: '', data: {} },
          { 'set-cookie': 'GTK=g; Path=/' },
        );
      }
      if (url.includes('/login.awp?v=') && body.includes('isReLogin')) {
        refreshCalls++;
        return json(
          { code: 200, token: 'new_token', message: '', data: {} },
          { 'X-Token': 'new_token' },
        );
      }
      if (url.includes('/notes.awp')) {
        notesCalls++;
        // Concurrent identical reads share one network request: the first
        // attempt expires, the single refresh fixes it, the retry succeeds.
        if (notesCalls === 1) return json({ code: 521, message: 'expired', data: {} });
        return json({ code: 200, message: '', data: { notes: [] } });
      }
      return json({ code: 404, message: 'x', data: {} });
    };
    const [r1, r2] = await Promise.all([ld.grades.getGrades(), ld.grades.getGrades()]);
    expect(refreshCalls).toBe(1);
    expect(notesCalls).toBe(2);
    expect(r1.notes).toEqual([]);
    expect(r2.notes).toEqual([]);
    expect(ld.ctx.token).toBe('new_token');
  });

  it('A10: rotated x-token is persisted, throttled to one write per 30 s', async () => {
    const store = new Map<string, string>();
    let edTkWrites = 0;
    const adapter = mapAdapter(store);
    const origSet = adapter.set;
    adapter.set = (k, v) => {
      if (k === 'ed_tk') edTkWrites++;
      return origSet(k, v);
    };
    ld.configure({ storage: adapter });
    let token = 'rotated-1';
    globalThis.fetch = async () => json({ code: 200, message: '', data: {} }, { 'x-token': token });
    await ld.grades.getGrades({ force: true });
    expect(ld.ctx.token).toBe('rotated-1');
    expect(store.get('ed_tk')).toBe('rotated-1');
    token = 'rotated-2';
    await ld.grades.getGrades({ force: true });
    expect(ld.ctx.token).toBe('rotated-2');
    expect(store.get('ed_tk')).toBe('rotated-1');
    expect(edTkWrites).toBe(1);
  });

  it('B4: a 250 on a normal request rejects with 2FA_REQUIRED', async () => {
    globalThis.fetch = async () => json({ code: 250, message: '2FA', data: {} });
    try {
      await ld.grades.getGrades();
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err).toBeInstanceOf(EdAuthError);
      expect(err.code).toBe('2FA_REQUIRED');
    }
  });

  it('D1: configure validates values and leaves config untouched', async () => {
    ld.configure({ concurrency: 3, timeout: 1000, maxRetries: 2, retryDelay: 5 });
    const bad: any[] = [
      { concurrency: 0 },
      { concurrency: 1.5 },
      { concurrency: NaN },
      { timeout: 0 },
      { timeout: -1 },
      { timeout: Infinity },
      { timeout: NaN },
      { maxRetries: -1 },
      { maxRetries: 1.5 },
      { retryDelay: -1 },
      { retryDelay: Infinity },
      { proxyUrl: 'not-a-url' },
      { proxyUrl: 'ftp://example.com' },
      { proxyUrl: 'relative/path' },
      { storageNamespace: 42 },
      { storageNamespace: 'has space' },
      { storageNamespace: 'has\ttab' },
      { maxRequestsPerMinute: -1 },
      { maxRequestsPerMinute: 1.5 },
      { maxRequestsPerMinute: NaN },
    ];
    for (const cfg of bad) {
      expect(() => ld.configure(cfg)).toThrow(EdValidationError);
    }
    expect(() => ld.configure({ storageNamespace: '' })).not.toThrow();
    expect(() => ld.configure({ storageNamespace: 'team-a' })).not.toThrow();
    expect(() => ld.configure({ maxRequestsPerMinute: 0 })).not.toThrow();
    const kept = ld.ctx.config;
    expect(kept.concurrency).toBe(3);
    expect(kept.timeout).toBe(1000);
    expect(kept.maxRetries).toBe(2);
    expect(kept.retryDelay).toBe(5);
    ld.configure({ proxyUrl: 'https://proxy.example.com/' });
    expect(ld.ctx.config.proxyUrl).toBe('https://proxy.example.com');
    ld.configure({ proxyUrl: undefined } as any);
    expect(ld.ctx.config.proxyUrl).toBeUndefined();
  });

  it('D4: SDK errors use the taxonomy', async () => {
    await ld.auth.clearSession();
    await expect(ld.auth.switchAccount(1)).rejects.toBeInstanceOf(EdError);
    ld.ctx.account = auditAccount;
    await expect(ld.auth.switchAccount(424242)).rejects.toBeInstanceOf(EdError);
    ld.ctx.account = auditAccount;

    globalThis.fetch = async () => new Response(null, { status: 200 });
    await expect(ld.downloads.download({ as: 'stream' })).rejects.toBeInstanceOf(EdError);

    const { localStorageStorage } = await import('../src/index');
    const hadLS = (globalThis as any).localStorage;
    try {
      (globalThis as any).localStorage = undefined;
      expect(() => localStorageStorage.get('x')).toThrow(EdError);
    } finally {
      (globalThis as any).localStorage = hadLS;
    }
  });

  it('E3: parseJsonResponse reads the body once', async () => {
    const { parseJsonResponse } = await import('../src/core/http');
    expect(await parseJsonResponse(json({ a: 1 }))).toEqual({ a: 1 });
    try {
      await parseJsonResponse(new Response('Not valid JSON', { status: 200 }));
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err).toBeInstanceOf(EdParseError);
      expect(err.message).toContain('Not valid JSON');
    }
  });

  it('E4: Retry-After is honored and carried on EdRateLimitError', async () => {
    const { parseRetryAfterMs, parseJsonResponse } = await import('../src/core/http');
    expect(parseRetryAfterMs('2')).toBe(2000);
    expect(parseRetryAfterMs('120')).toBe(30000);
    const future = new Date(Date.now() + 5000).toUTCString();
    const ms = parseRetryAfterMs(future)!;
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(30000);
    expect(parseRetryAfterMs('garbage')).toBeUndefined();

    ld.configure({ maxRetries: 0 });
    try {
      await parseJsonResponse(new Response('{}', { status: 429, headers: { 'retry-after': '2' } }));
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err).toBeInstanceOf(EdRateLimitError);
      expect(err.retryAfterMs).toBe(2000);
    }

    // A 429 with Retry-After: 0 is retried immediately on a read.
    ld.configure({ maxRetries: 1, retryDelay: 1 });
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      if (calls === 1) return new Response('{}', { status: 429, headers: { 'retry-after': '0' } });
      return json({ code: 200, message: '', data: { notes: [] } });
    };
    const res = await ld.grades.getGrades();
    expect(calls).toBe(2);
    expect(res.notes).toEqual([]);
  });

  it('C7: safeSetInterval unrefs its timer', async () => {
    const { safeSetInterval } = await import('../src/core/env');
    let unrefCalled = false;
    const origSI = globalThis.setInterval;
    (globalThis as any).setInterval = (() => ({ unref: () => void (unrefCalled = true) })) as any;
    try {
      safeSetInterval(() => {}, 1000);
    } finally {
      globalThis.setInterval = origSI;
    }
    expect(unrefCalled).toBe(true);
  });

  it('C7: a polling script exits on its own', async () => {
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const script = join(tmpdir(), `ld-poll-exit-${Date.now()}.ts`);
    const srcDir = new URL('../src/', import.meta.url).pathname;
    await Bun.write(
      script,
      `import { Litedirecte, createMemoryStorage } from '${srcDir}index';
const ld = new Litedirecte({ storage: createMemoryStorage(), maxRetries: 0 });
(globalThis as any).fetch = async () => new Response(JSON.stringify({ code: 200, message: '', data: {} }), { status: 200 });
ld.ctx.account = { idLogin: 1, id: 1, uid: 'u', identifiant: 't', typeCompte: 'E', prenom: 'J', nom: 'D', email: 'e', nomEtablissement: 's', main: true, profile: { sexe: 'M', photo: '' }, modules: [] };
ld.ctx.token = 't';
// Polling is armed at construction (and unref'd): a polling script exits alone.
`,
    );
    try {
      const proc = Bun.spawn(['bun', script], { stdout: 'pipe', stderr: 'pipe' });
      const timeout = setTimeout(() => {
        try {
          proc.kill();
        } catch {}
      }, 8000);
      const code = await proc.exited;
      clearTimeout(timeout);
      expect(code).toBe(0);
    } finally {
      const { unlink } = await import('node:fs/promises');
      await unlink(script).catch(() => {});
    }
  });
});
