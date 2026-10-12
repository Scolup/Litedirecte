// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import type { StorageAdapter } from '../types';
import { getWebCrypto } from './env';
import { EdValidationError } from './errors';

const ALGORITHM = 'AES-GCM';
const SALT_LEN = 16;
const IV_LEN = 12;
const KEY_LEN = 32;
const KDF_ITERATIONS = 100_000;

const SALT_STORAGE_KEY = '__ld_salt';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(data: string): Uint8Array<ArrayBuffer> {
  const binary = atob(data);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    buf[i] = binary.charCodeAt(i);
  }
  return buf;
}

async function deriveKey(secret: string, salt: Uint8Array): Promise<CryptoKey> {
  const webCrypto = await getWebCrypto();
  const keyMaterial = await webCrypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return webCrypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as any,
      iterations: KDF_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: ALGORITHM, length: KEY_LEN * 8 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptWithKey(plaintext: string, key: CryptoKey): Promise<string> {
  const webCrypto = await getWebCrypto();
  const iv = webCrypto.getRandomValues(new Uint8Array(IV_LEN));
  const encrypted = await webCrypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  const result = new Uint8Array(iv.length + encrypted.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(encrypted), iv.length);
  return toBase64(result);
}

async function decryptWithKey(data: string, key: CryptoKey): Promise<string> {
  const webCrypto = await getWebCrypto();
  const buf = fromBase64(data);
  if (buf.length < IV_LEN) {
    throw new EdValidationError('Invalid encrypted data', 'STORAGE_DECRYPT_FAILED');
  }
  const iv = buf.subarray(0, IV_LEN);
  const ciphertext = buf.subarray(IV_LEN);
  const decrypted = await webCrypto.subtle.decrypt({ name: ALGORITHM, iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}

/** Create an isolated in-memory storage adapter (one per instance). */
export function createMemoryStorage(): StorageAdapter {
  const data = new Map<string, string>();
  return {
    get: (key) => data.get(key) || null,
    set: (key, value) => {
      data.set(key, value);
    },
    delete: (key) => {
      data.delete(key);
    },
  };
}

export const localStorageStorage: StorageAdapter = {
  get: (key) => getLocalStorage().getItem(key),
  set: (key, value) => getLocalStorage().setItem(key, value),
  delete: (key) => getLocalStorage().removeItem(key),
};

function getLocalStorage(): Storage {
  if (typeof globalThis.localStorage === 'undefined') {
    throw new EdValidationError(
      'localStorage is not available in this environment.',
      'UNSUPPORTED_ENVIRONMENT',
    );
  }
  return globalThis.localStorage;
}

function openIDB(): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = (globalThis as any).indexedDB.open('litedirecte', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('data')) {
        db.createObjectStore('data');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Stateless IndexedDB adapter: opens the DB per call so no connection is cached. */
export const indexedDBStorage: StorageAdapter = {
  get: async (key) => {
    try {
      const db = await openIDB();
      return new Promise<string | null>((resolve) => {
        const tx = db.transaction('data', 'readonly');
        const req = tx.objectStore('data').get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  },
  set: async (key, value) => {
    const db = await openIDB();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('data', 'readwrite');
      tx.objectStore('data').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  },
  delete: async (key) => {
    const db = await openIDB();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('data', 'readwrite');
      tx.objectStore('data').delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  },
};

export function nodeStorage(filePath = './litedirecte-session.json'): StorageAdapter {
  let chain: Promise<any> = Promise.resolve();
  const run = <T>(op: () => Promise<T>): Promise<T> => {
    const next = chain.then(op, op);
    chain = next.catch(() => {});
    return next;
  };
  const readAll = async (): Promise<Record<string, string>> => {
    const { readFile, rename } = await import('node:fs/promises');
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch (err: any) {
      if (err?.code === 'ENOENT') return {};
      throw err;
    }
    try {
      return JSON.parse(raw);
    } catch {
      try {
        await rename(filePath, `${filePath}.corrupt`);
      } catch {}
      return {};
    }
  };
  const writeAll = async (data: Record<string, string>): Promise<void> => {
    const { writeFile, mkdir, rename } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    await mkdir(dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    await rename(tmp, filePath);
  };
  return asyncStorage({
    getItem: (k) => run(async () => (await readAll())[k] ?? null),
    setItem: (k, v) =>
      run(async () => {
        const data = await readAll();
        data[k] = v;
        await writeAll(data);
      }),
    removeItem: (k) =>
      run(async () => {
        const data = await readAll();
        delete data[k];
        await writeAll(data);
      }),
  });
}

export function cloudflareKVStorage(namespace: {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}): StorageAdapter {
  return asyncStorage({
    getItem: (k) => namespace.get(k),
    setItem: (k, v) => namespace.put(k, v),
    removeItem: (k) => namespace.delete(k),
  });
}

export function asyncStorage(backend: {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}): StorageAdapter {
  return {
    get: (key) => backend.getItem(key),
    set: (key, value) => backend.setItem(key, value),
    delete: (key) => backend.removeItem(key),
  };
}

/** Prefix every key so several instances can share one adapter. */
export function namespacedStorage(backend: StorageAdapter, prefix: string): StorageAdapter {
  return {
    get: (key) => backend.get(`${prefix}${key}`),
    set: (key, value) => backend.set(`${prefix}${key}`, value),
    delete: (key) => backend.delete(`${prefix}${key}`),
  };
}

export function encryptedStorage(
  backend: StorageAdapter,
  secret: string,
  onError?: () => ((error: any) => void | Promise<void>) | undefined,
): StorageAdapter {
  let keyPromise: Promise<CryptoKey> | undefined;
  let saltPromise: Promise<Uint8Array> | undefined;
  const reportedKeys = new Set<string>();
  const loadOrCreateSalt = async (): Promise<Uint8Array> => {
    if (!saltPromise) {
      saltPromise = (async () => {
        try {
          const stored = await backend.get(SALT_STORAGE_KEY);
          if (stored) {
            try {
              const salt = fromBase64(stored);
              if (salt.length === SALT_LEN) return salt;
            } catch {}
          }
          const webCrypto = await getWebCrypto();
          const salt = webCrypto.getRandomValues(new Uint8Array(SALT_LEN));
          await backend.set(SALT_STORAGE_KEY, toBase64(salt));
          return salt;
        } catch (error) {
          saltPromise = undefined;
          throw error;
        }
      })();
    }
    return saltPromise;
  };
  const getKey = (): Promise<CryptoKey> => {
    if (!keyPromise) {
      keyPromise = loadOrCreateSalt().then((salt) => deriveKey(secret, salt));
      keyPromise.catch(() => {
        keyPromise = undefined;
      });
    }
    return keyPromise;
  };
  const adapter: StorageAdapter = {
    get: async (key) => {
      const val = await backend.get(key);
      if (!val) return null;
      try {
        return await decryptWithKey(val, await getKey());
      } catch {
        if (!reportedKeys.has(key)) {
          reportedKeys.add(key);
          const { EdError } = await import('./errors');
          try {
            await onError?.()?.(
              new EdError(`Cannot decrypt stored value for key "${key}"`, 'STORAGE_DECRYPT_FAILED'),
            );
          } catch {}
        }
        return null;
      }
    },
    set: async (key, value) => {
      const encrypted = await encryptWithKey(value, await getKey());
      await backend.set(key, encrypted);
    },
    delete: async (key) => {
      await backend.delete(key);
    },
  };
  return adapter;
}
