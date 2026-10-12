// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Litedirecte } from '../src/index';
import { createTestClient } from './setup';

describe('Offline Queue Module', () => {
  let originalFetch: typeof globalThis.fetch;
  let requests: string[] = [];
  let ld: Litedirecte;

  const mockStorage = {
    store: new Map<string, string>(),
    get(key: string) {
      return this.store.get(key) || null;
    },
    set(key: string, val: string) {
      this.store.set(key, val);
    },
    delete(key: string) {
      this.store.delete(key);
    },
  };

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    requests = [];
    mockStorage.store.clear();
    ({ ld } = createTestClient({ storage: mockStorage }));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    ld.destroy();
  });

  it('pushes mutations to queue and persists them to storage', async () => {
    await ld.offlineQueue.push('/some-endpoint.awp', { body: 'data' });

    const queue = ld.offlineQueue.getQueue();
    expect(queue.length).toBe(1);
    expect(queue[0].endpoint).toBe('/some-endpoint.awp');
    expect(queue[0].options).toEqual({ body: 'data' });

    const savedStr = mockStorage.get('ed_offline_queue');
    expect(savedStr).toBeDefined();
    expect(JSON.parse(savedStr!)[0].endpoint).toBe('/some-endpoint.awp');
  });

  it('flushes the queue successfully and deletes items upon successful request', async () => {
    globalThis.fetch = async (input) => {
      requests.push(input.toString());
      return new Response(JSON.stringify({ code: 200, message: '', data: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    await ld.offlineQueue.push('/mutation-1.awp', { method: 'POST', body: { x: 1 } });
    await ld.offlineQueue.push('/mutation-2.awp', { method: 'POST', body: { x: 2 } });

    expect(ld.offlineQueue.getQueue().length).toBe(2);

    await ld.offlineQueue.flush();

    expect(requests.length).toBe(2);
    expect(requests[0]).toContain('/mutation-1.awp');
    expect(requests[1]).toContain('/mutation-2.awp');

    expect(ld.offlineQueue.getQueue().length).toBe(0);
    const saved = JSON.parse(mockStorage.get('ed_offline_queue') || '[]');
    expect(saved.length).toBe(0);
  });

  it('prevents concurrent flushes from executing in parallel and duplicating calls', async () => {
    let callCount = 0;
    globalThis.fetch = async (input) => {
      callCount++;
      await new Promise((r) => setTimeout(r, 10));
      return new Response(JSON.stringify({ code: 200, message: '', data: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    await ld.offlineQueue.push('/mutation-concurrent.awp', { method: 'POST', body: { x: 1 } });

    await Promise.all([ld.offlineQueue.flush(), ld.offlineQueue.flush()]);

    expect(callCount).toBe(1);
  });

  it('preserves mutation pushed before hydration resolves (deferred-get test)', async () => {
    let resolveGet: (val: string | null) => void = () => {};
    const deferredGetPromise = new Promise<string | null>((resolve) => {
      resolveGet = resolve;
    });

    const slowStorage = {
      get(key: string) {
        if (key === 'ed_offline_queue') {
          return deferredGetPromise;
        }
        return null;
      },
      async set(key: string, val: string) {},
      async delete(key: string) {},
    };

    ld.configure({ storage: slowStorage });

    const pushPromise = ld.offlineQueue.push('/slow-endpoint.awp', { method: 'POST' });

    resolveGet(null);
    await pushPromise;

    expect(ld.offlineQueue.getQueue().length).toBe(1);
    expect(ld.offlineQueue.getQueue()[0].endpoint).toBe('/slow-endpoint.awp');
  });

  it('serializes queue persistence in order even if async sets have variable delays', async () => {
    const writeHistory: string[] = [];
    let resolveFirstSet: () => void = () => {};
    const firstSetPromise = new Promise<void>((r) => {
      resolveFirstSet = r;
    });

    let isFirst = true;

    const slowSetStorage = {
      store: new Map<string, string>(),
      async get(key: string) {
        return this.store.get(key) || null;
      },
      async set(key: string, val: string) {
        if (isFirst) {
          isFirst = false;
          await firstSetPromise;
        }
        this.store.set(key, val);
        writeHistory.push(val);
      },
      async delete(key: string) {},
    };

    ld.configure({ storage: slowSetStorage });

    const p1 = ld.offlineQueue.push('/mutation-slow.awp', { body: 1 });
    const p2 = ld.offlineQueue.push('/mutation-fast.awp', { body: 2 });

    resolveFirstSet();
    await Promise.all([p1, p2]);

    const finalStored = JSON.parse(slowSetStorage.store.get('ed_offline_queue') || '[]');
    expect(finalStored.length).toBe(2);
    expect(finalStored[1].endpoint).toBe('/mutation-fast.awp');

    expect(writeHistory.length).toBe(2);
    expect(writeHistory[0]).toContain('/mutation-slow.awp');
    expect(writeHistory[1]).toContain('/mutation-fast.awp');
  });

  it('returns shared promise on concurrent flush and both remain pending until delayed fetch completes', async () => {
    let resolveFetch: (res: any) => void = () => {};
    const fetchPromise = new Promise<any>((resolve) => {
      resolveFetch = resolve;
    });

    globalThis.fetch = async () => {
      await fetchPromise;
      return new Response(JSON.stringify({ code: 200, message: '', data: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    ld.configure({ storage: mockStorage });

    await ld.offlineQueue.push('/mutation-flush.awp', { method: 'POST' });

    let f1Resolved = false;
    let f2Resolved = false;

    const f1 = ld.offlineQueue.flush().then(() => {
      f1Resolved = true;
    });
    const f2 = ld.offlineQueue.flush().then(() => {
      f2Resolved = true;
    });

    expect(f1Resolved).toBe(false);
    expect(f2Resolved).toBe(false);

    resolveFetch(null);
    await Promise.all([f1, f2]);

    expect(f1Resolved).toBe(true);
    expect(f2Resolved).toBe(true);
  });

  it('allows flushing again after flushing an empty queue (flush empty-queue path regression)', async () => {
    let callCount = 0;
    globalThis.fetch = async (input) => {
      callCount++;
      return new Response(JSON.stringify({ code: 200, message: '', data: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    ld.configure({ storage: mockStorage });

    // Flush an empty queue first (no requests should be sent, flushPromise should be cleared!)
    await ld.offlineQueue.flush();
    expect(callCount).toBe(0);

    // Enqueue a mutation
    await ld.offlineQueue.push('/mutation-after-empty.awp', { method: 'POST', body: { x: 1 } });

    // Flush again
    await ld.offlineQueue.flush();

    // Verify the mutation was delivered
    expect(callCount).toBe(1);
    expect(ld.offlineQueue.getQueue().length).toBe(0);
  });

  it('A8: permanently rejected entries are dropped, network failures kept', async () => {
    globalThis.fetch = async (input) => {
      const url = input.toString();
      if (url.includes('/rejected.awp')) {
        return new Response(JSON.stringify({ code: 505, message: 'Invalid credentials' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error('offline');
    };

    await ld.offlineQueue.push('/rejected.awp?verbe=put', { method: 'POST', body: { x: 1 } });
    await ld.offlineQueue.push('/offline.awp?verbe=put', { method: 'POST', body: { x: 2 } });
    expect(ld.offlineQueue.getQueue().length).toBe(2);

    await ld.offlineQueue.flush();

    // 505 is gone after one flush; the network failure stays queued.
    expect(ld.offlineQueue.getQueue().length).toBe(1);
    expect(ld.offlineQueue.getQueue()[0].endpoint).toBe('/offline.awp?verbe=put');

    // Five failed attempts drop the entry.
    for (let i = 0; i < 4; i++) await ld.offlineQueue.flush();
    expect(ld.offlineQueue.getQueue().length).toBe(0);

    // Entries older than 7 days are dropped immediately.
    await ld.offlineQueue.push('/stale.awp?verbe=put', { method: 'POST' });
    (ld.offlineQueue.getQueue()[0] as any).timestamp = Date.now() - 8 * 24 * 60 * 60 * 1000;
    await ld.offlineQueue.flush();
    expect(ld.offlineQueue.getQueue().length).toBe(0);
  });
});
