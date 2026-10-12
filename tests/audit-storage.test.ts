// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Litedirecte, encryptedStorage } from '../src/index';
import { createTestClient } from './setup';
import { nodeStorage } from '../src/core/storage';
import { persistSession } from '../src/core/store';
import { EdError } from '../src/core/errors';

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

describe('Audit fixes (storage)', () => {
  let ld: Litedirecte;

  beforeEach(() => {
    ({ ld } = createTestClient({ storage: mapAdapter(new Map()) }));
    ld.ctx.account = auditAccount;
    ld.ctx.token = 'test_token';
  });

  afterEach(() => {
    ld.destroy();
  });

  it('A5: 20 concurrent nodeStorage sets all survive', async () => {
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const file = join(tmpdir(), `ld-a5-${Date.now()}-${Math.random().toString(36).slice(1)}.json`);
    try {
      const storage = nodeStorage(file);
      await Promise.all(Array.from({ length: 20 }, (_, i) => storage.set(`k${i}`, `v${i}`)));
      for (let i = 0; i < 20; i++) {
        expect(await storage.get(`k${i}`)).toBe(`v${i}`);
      }
      const { stat } = await import('node:fs/promises');
      expect((await stat(file)).mode & 0o777).toBe(0o600);
    } finally {
      const { unlink } = await import('node:fs/promises');
      await unlink(file).catch(() => {});
      await unlink(`${file}.corrupt`).catch(() => {});
      await unlink(`${file}.tmp`).catch(() => {});
    }
  });

  it('A5: a truncated file is moved aside, not silently lost', async () => {
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { writeFile, readFile, unlink, stat } = await import('node:fs/promises');
    const file = join(tmpdir(), `ld-a5c-${Date.now()}-${Math.random().toString(36).slice(1)}.json`);
    try {
      const storage = nodeStorage(file);
      await storage.set('keep', 'me');
      expect(await storage.get('keep')).toBe('me');
      await writeFile(file, '{"truncated": ');
      expect(await storage.get('keep')).toBeNull();
      await stat(`${file}.corrupt`);
      const corrupt = await readFile(`${file}.corrupt`, 'utf-8');
      expect(corrupt).toBe('{"truncated": ');
      // The store keeps working after the incident.
      await storage.set('after', 'yes');
      expect(await storage.get('after')).toBe('yes');
    } finally {
      await unlink(file).catch(() => {});
      await unlink(`${file}.corrupt`).catch(() => {});
      await unlink(`${file}.tmp`).catch(() => {});
    }
  });

  it('E1: 50 operations derive the key once', async () => {
    const backend = mapAdapter(new Map());
    const enc = encryptedStorage(backend, 'pw-one-key');
    const subtle = globalThis.crypto.subtle;
    const orig = subtle.deriveKey.bind(subtle);
    let derivations = 0;
    (subtle as any).deriveKey = (async (...args: any[]) => {
      derivations++;
      return orig(...(args as [any, any, any, any, any]));
    }) as any;
    try {
      for (let i = 0; i < 25; i++) await enc.set(`k${i}`, `v${i}`);
      for (let i = 0; i < 25; i++) expect(await enc.get(`k${i}`)).toBe(`v${i}`);
      expect(derivations).toBe(1);
    } finally {
      (subtle as any).deriveKey = orig;
    }
  });

  it('E1: wrong passkey returns null and reports STORAGE_DECRYPT_FAILED once', async () => {
    const store = new Map<string, string>();
    const backend = mapAdapter(store);
    const enc = encryptedStorage(backend, 'right-key');
    await enc.set('secret', 'value');
    const seen: any[] = [];
    const wrong = encryptedStorage(backend, 'wrong-key', () => async (e: any) => void seen.push(e));
    expect(await wrong.get('secret')).toBeNull();
    expect(await wrong.get('secret')).toBeNull();
    expect(seen.length).toBe(1);
    expect(seen[0]).toBeInstanceOf(EdError);
    expect(seen[0].code).toBe('STORAGE_DECRYPT_FAILED');
  });

  it('E1: concurrent first use creates a single salt', async () => {
    const store = new Map<string, string>();
    let saltSets = 0;
    const backend = {
      get: (k: string) => store.get(k) ?? null,
      set: (k: string, v: string) => {
        if (k === '__ld_salt') saltSets++;
        store.set(k, v);
      },
      delete: (k: string) => void store.delete(k),
    };
    const enc = encryptedStorage(backend, 'fresh-secret');
    await Promise.all([enc.set('a', '1'), enc.set('b', '2'), enc.get('a'), enc.get('b')]);
    expect(saltSets).toBe(1);
    expect(await enc.get('a')).toBe('1');
    expect(await enc.get('b')).toBe('2');
  });

  it('E2: persistSession reports storage errors instead of failing', async () => {
    const seen: any[] = [];
    const { ld: ld2 } = createTestClient({
      storage: {
        get: () => null,
        set: () => Promise.reject(new Error('disk full')),
        delete: () => {},
      },
      onError: async (e: any) => void seen.push(e),
    });
    try {
      ld2.ctx.token = 'test_token';
      ld2.ctx.account = auditAccount;
      await persistSession(ld2.ctx);
      expect(seen.length).toBeGreaterThan(0);
    } finally {
      ld2.destroy();
    }
  });

  it('E2: IndexedDB set/delete settle on tx completion and open retries', async () => {
    const { indexedDBStorage } = await import('../src/index');
    const data = new Map<string, string>();
    let opens = 0;
    let failOpen = true;
    let failTx = false;
    const makeTx = () => {
      const tx: any = {
        objectStore: () => ({
          get: (key: string) => {
            const req: any = {};
            queueMicrotask(() => {
              req.result = data.get(key) ?? null;
              req.onsuccess?.();
            });
            return req;
          },
          put: (value: string, key: string) => {
            queueMicrotask(() => {
              if (failTx) tx.onerror?.(new Error('tx failed'));
              else {
                data.set(key, value);
                tx.oncomplete?.();
              }
            });
          },
          delete: (key: string) => {
            queueMicrotask(() => {
              if (failTx) tx.onerror?.(new Error('tx failed'));
              else {
                data.delete(key);
                tx.oncomplete?.();
              }
            });
          },
        }),
      };
      return tx;
    };
    const origIDB = (globalThis as any).indexedDB;
    (globalThis as any).indexedDB = {
      open: () => {
        opens++;
        const req: any = {};
        queueMicrotask(() => {
          if (failOpen) req.onerror?.(new Error('open failed'));
          else {
            req.result = { transaction: () => makeTx() };
            req.onsuccess?.();
          }
        });
        return req;
      },
    };
    try {
      // First open fails…
      await expect(indexedDBStorage.set('k', 'v')).rejects.toThrow();
      // …but nothing is cached so the next call retries with a fresh open.
      failOpen = false;
      await indexedDBStorage.set('k', 'v');
      expect(await indexedDBStorage.get('k')).toBe('v');
      await indexedDBStorage.delete('k');
      expect(await indexedDBStorage.get('k')).toBeNull();
      // Transaction errors reject set/delete.
      failTx = true;
      await expect(indexedDBStorage.set('k', 'v')).rejects.toThrow();
      await expect(indexedDBStorage.delete('k')).rejects.toThrow();
      expect(opens).toBeGreaterThanOrEqual(2);
    } finally {
      (globalThis as any).indexedDB = origIDB;
    }
  });
});
