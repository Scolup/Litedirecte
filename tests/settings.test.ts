// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Litedirecte, createMemoryStorage } from '../src/index';
import { seedSession, testAccount } from './setup';

describe('Settings Module', () => {
  let originalFetch: typeof globalThis.fetch;
  let requests: { url: string; method: string; body: any }[] = [];
  let ld: Litedirecte;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    requests = [];
    ld = new Litedirecte({ storage: createMemoryStorage(), maxRetries: 0 });
    await seedSession(ld.ctx.config.storage!, ld, testAccount(), 'test_token');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    ld.destroy();
  });

  it('retrieves settings successfully', async () => {
    globalThis.fetch = async (input, init) => {
      const urlStr = input.toString();
      const method = init?.method || 'GET';
      let parsedBody: any = undefined;
      if (init?.body) {
        const bodyStr = init.body.toString();
        if (bodyStr.startsWith('data=')) {
          parsedBody = JSON.parse(decodeURIComponent(bodyStr.substring(5)));
        } else {
          parsedBody = bodyStr;
        }
      }
      requests.push({ url: urlStr, method, body: parsedBody });

      return new Response(
        JSON.stringify({
          code: 200,
          message: '',
          data: {
            email: 'john.doe@example.com',
            portable: '0600000000',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const result = await ld.settings.getSettings();

    expect(requests.length).toBe(1);
    expect(requests[0].url).toContain('/logins/1234567.awp');
    expect(result.email).toBe('john.doe@example.com');
    expect(result.portable).toBe('0600000000');
  });

  it('updates settings successfully', async () => {
    globalThis.fetch = async (input, init) => {
      const urlStr = input.toString();
      const method = init?.method || 'GET';
      let parsedBody: any = undefined;
      if (init?.body) {
        const bodyStr = init.body.toString();
        if (bodyStr.startsWith('data=')) {
          parsedBody = JSON.parse(decodeURIComponent(bodyStr.substring(5)));
        } else {
          parsedBody = bodyStr;
        }
      }
      requests.push({ url: urlStr, method, body: parsedBody });

      return new Response(
        JSON.stringify({
          code: 200,
          message: '',
          data: {
            email: 'new.doe@example.com',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const result = await ld.settings.updateSettings({ email: 'new.doe@example.com' });

    expect(requests.length).toBe(1);
    expect(requests[0].url).toContain('/logins/1234567.awp');
    expect(requests[0].body).toEqual({
      identifiant: 'Test.user',
      email: 'new.doe@example.com',
    });
    expect(result.email).toBe('new.doe@example.com');
  });
  it('updates accessibility successfully', async () => {
    globalThis.fetch = async (input, init) => {
      const urlStr = input.toString();
      const method = init?.method || 'GET';
      let parsedBody: any = undefined;
      if (init?.body) {
        const bodyStr = init.body.toString();
        if (bodyStr.startsWith('data=')) {
          parsedBody = JSON.parse(decodeURIComponent(bodyStr.substring(5)));
        } else {
          parsedBody = bodyStr;
        }
      }
      requests.push({ url: urlStr, method, body: parsedBody });

      return new Response(
        JSON.stringify({
          code: 200,
          message: '',
          data: {
            success: true,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const result = await ld.settings.updateAccessibility(true);

    expect(requests.length).toBe(1);
    expect(requests[0].url).toContain('/parametreIndividuel.awp');
    expect(requests[0].body).toEqual({
      path: 'Préférences/Elèves/accessibiliteVisuelle/9876',
      value: '1',
    });
    expect(result.success).toBe(true);
  });

  it('A3: failed updateSettings never persists a password', async () => {
    const store = new Map<string, string>();
    const storage = {
      get: (k: string) => store.get(k) ?? null,
      set: (k: string, v: string) => void store.set(k, v),
      delete: (k: string) => void store.delete(k),
    };
    const ld2 = new Litedirecte({ storage, offlineQueue: true, maxRetries: 0 });
    await seedSession(storage, ld2, testAccount(), 'test_token');

    globalThis.fetch = async () => {
      throw new Error('Connection refused');
    };

    await expect(
      ld2.settings.updateSettings({ nouveauMotDePasse: 's3cret-pw' } as any),
    ).rejects.toThrow();
    // Give any fire-and-forget queue write a chance to run.
    await new Promise((r) => setTimeout(r, 10));

    expect(ld2.offlineQueue.getQueue().length).toBe(0);
    for (const value of store.values()) {
      expect(value).not.toContain('s3cret-pw');
    }
    ld2.destroy();
  });
});
