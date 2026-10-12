// © 2026 typeof (Scolup) | Licensed under AGPL 3.
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { Litedirecte } from '../src/index';
import { createTestClient, seedSession, testAccount } from './setup';
import { __keepaliveTickForTests, isKeepaliveActive } from '../src/core/health';
import { EdAuthError, EdNetworkError } from '../src/core/errors';

describe('Token Health Module', () => {
  let originalFetch: typeof globalThis.fetch;
  let requests: string[] = [];
  let ld: Litedirecte;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    requests = [];
    ({ ld } = createTestClient());
    await seedSession(ld.ctx.config.storage!, ld, testAccount(), 'test_token');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    ld.destroy();
  });

  it('returns true if token health check is successful (code 200)', async () => {
    globalThis.fetch = async (input) => {
      requests.push(input.toString());
      return new Response(JSON.stringify({ code: 200, message: '', data: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const result = await ld.auth.checkTokenHealth();

    expect(requests.length).toBe(1);
    expect(requests[0]).toContain('/rdt/sondages.awp');
    expect(result).toBe(true);
  });

  it('returns false if token health check fails or returns non-200', async () => {
    globalThis.fetch = async (input) => {
      requests.push(input.toString());
      return new Response(JSON.stringify({ code: 500, message: 'Expired' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const result = await ld.auth.checkTokenHealth();

    expect(requests.length).toBe(1);
    expect(result).toBe(false);
  });

  it('can start and stop token keepalive keepalive timers', () => {
    ld.auth.startTokenKeepalive();
    expect(isKeepaliveActive(ld.ctx)).toBe(true);
    ld.auth.stopTokenKeepalive();
    expect(isKeepaliveActive(ld.ctx)).toBe(false);
  });

  it('A10: checkTokenHealth applies the rotated x-token header', async () => {
    const store = new Map<string, string>();
    const { ld: ld2 } = createTestClient({
      storage: {
        get: (k: string) => store.get(k) ?? null,
        set: (k: string, v: string) => void store.set(k, v),
        delete: (k: string) => void store.delete(k),
      },
    });
    try {
      await seedSession(ld2.ctx.config.storage!, ld2, testAccount(), 'test_token');
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ code: 200, message: '', data: {} }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'x-token': 'rotated-token' },
        });
      expect(await ld2.auth.checkTokenHealth()).toBe(true);
      expect(ld2.ctx.token).toBe('rotated-token');
      // Persisted at most once per 30 s: the second response writes nothing.
      let writes = 0;
      const origSet = store.set.bind(store);
      store.set = (k, v) => {
        if (k === 'ed_tk') writes++;
        return origSet(k, v);
      };
      expect(await ld2.auth.checkTokenHealth()).toBe(true);
      expect(writes).toBe(0);
      expect(store.get('ed_tk')).toBe('rotated-token');
    } finally {
      ld2.destroy();
    }
  });

  it('C6: network failure keeps the keepalive alive, auth failure stops it', async () => {
    const store = new Map<string, string>([
      ['ed_access_token_9876', 'saved_access_token'],
      ['ed_uuid_9876', 'saved_uuid'],
    ]);
    const onError = mock((_e: any) => {});
    const { ld: ld2 } = createTestClient({
      storage: {
        get: (k: string) => store.get(k) ?? null,
        set: (k: string, v: string) => void store.set(k, v),
        delete: (k: string) => void store.delete(k),
      },
      onError,
    });
    try {
      await seedSession(ld2.ctx.config.storage!, ld2, testAccount(), 'test_token');

      // Unhealthy token + offline refresh: timer stays, onError is called.
      globalThis.fetch = async (input) => {
        const url = input.toString();
        if (url.includes('sondages.awp')) {
          return new Response(JSON.stringify({ code: 500, message: 'Expired' }), { status: 200 });
        }
        if (url.includes('login.awp?gtk=1')) {
          return new Response(JSON.stringify({ code: 200, token: '', message: '', data: {} }), {
            status: 200,
            headers: { 'set-cookie': 'GTK=g; Path=/' },
          });
        }
        throw new Error('offline');
      };
      ld2.auth.startTokenKeepalive();
      await __keepaliveTickForTests(ld2.ctx);
      expect(isKeepaliveActive(ld2.ctx)).toBe(true);
      expect(onError).toHaveBeenCalled();
      const firstError = onError.mock.calls[0][0];
      expect(firstError).toBeInstanceOf(EdNetworkError);

      // Auth failure stops the keepalive.
      await ld2.auth.clearSession();
      onError.mockClear();
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ code: 500, message: 'Expired' }), { status: 200 });
      await __keepaliveTickForTests(ld2.ctx);
      expect(isKeepaliveActive(ld2.ctx)).toBe(false);
      expect(onError).toHaveBeenCalled();
      expect(onError.mock.calls[0][0]).toBeInstanceOf(EdAuthError);
      ld2.auth.stopTokenKeepalive();
    } finally {
      ld2.destroy();
    }
  });
});
