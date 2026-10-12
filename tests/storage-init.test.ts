// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
//
// Regression guard: the cache resolves its storage adapter through getStorage(),
// which detects the platform default on first use. Reaching a cache write without
// ever calling a public API first must still persist.
import { describe, expect, test } from 'bun:test';
import { Litedirecte } from '../src/index';
import { createMemoryStorage } from '../src/core/storage';
import { getStorage } from '../src/core/context';
import { writeEntry } from '../src/core/cache';

function account(id: number, loginId: number) {
  return {
    id,
    idLogin: loginId,
    typeCompte: 'E',
    identifiant: `id${id}`,
    profile: {} as never,
  };
}

describe('storage resolution', () => {
  test('a cache write on a fresh context detects and persists to storage', async () => {
    const ld = new Litedirecte({ storage: createMemoryStorage() });
    ld.ctx.account = account(1, 10);

    // Deliberately no getConfig() call first: this is the path that used to
    // no-op when the cache read ctx.config.storage directly.
    expect(getStorage(ld.ctx)).toBeDefined();

    writeEntry(ld.ctx, 'grades|1|period=', 'grades', 1, { notes: [] }, false);
    const written = await getStorage(ld.ctx)!.get('ed_cache::grades|1|period=');
    expect(written).toBeTruthy();
  });

  test('getStorage never throws on a destroyed instance', () => {
    const ld = new Litedirecte({ storage: createMemoryStorage() });
    ld.ctx.destroyed = true;
    expect(() => getStorage(ld.ctx)).not.toThrow();
  });

  test('getStorage returns the configured adapter', () => {
    const storage = createMemoryStorage();
    const ld = new Litedirecte({ storage });
    expect(getStorage(ld.ctx)).toBe(storage);
  });

  test('a namespace wraps the configured adapter', async () => {
    const backing = createMemoryStorage();
    const ld = new Litedirecte({ storage: backing, storageNamespace: 'acct-7::' });
    await getStorage(ld.ctx)!.set('k', 'v');
    expect(await backing.get('acct-7::k')).toBe('v');
    expect(await backing.get('k')).toBeNull();
  });
});
