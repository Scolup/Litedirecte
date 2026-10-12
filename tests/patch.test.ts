// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
//
// Regression guard for patchResourceEntries (shared by homework markAsDone and
// messages markAsRead). Two things matter: the optimistic cache patch is applied,
// and the entry's fetchedAt follows the injected clock rather than Date.now().
import { describe, expect, test } from 'bun:test';
import { Litedirecte } from '../src/index';
import { createMemoryStorage } from '../src/core/storage';
import { writeEntry, keyFor } from '../src/core/cache';
import { getStorage } from '../src/core/context';
import { parseBody } from './helpers';

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify({ code: 200, message: '', data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function loggedIn(storage = createMemoryStorage()) {
  const ld = new Litedirecte({ storage });
  ld.ctx.account = {
    loginId: 1234567,
    id: 9876,
    identifiant: 'Test.user',
    accountType: 'E',
    profile: {},
  } as never;
  return ld;
}

describe('patchResourceEntries', () => {
  test('marks homework done in the cached index and persists it', async () => {
    const storage = createMemoryStorage();
    const ld = loggedIn(storage);
    const key = keyFor('homework', 9876, 'index');
    writeEntry(
      ld.ctx,
      key,
      'homework',
      9876,
      { '2026-03-23': [{ idDevoir: 7, effectue: false }] },
      false,
    );

    globalThis.fetch = async () => jsonResponse({ success: true });
    await ld.homework.markAsDone([7]);

    const slot = ld.ctx.cacheMem.get(key)!;
    expect((slot.value as any)['2026-03-23'][0].effectue).toBe(true);
    const persisted = JSON.parse((await getStorage(ld.ctx)!.get(`ed_cache::${key}`))!);
    expect(persisted.raw['2026-03-23'][0].effectue).toBe(true);
  });

  test('marks messages read only in list entries', async () => {
    const ld = loggedIn();
    const listKey = keyFor('messages', 9876, 'list.year=.folder=.page=0');
    const detailKey = keyFor('messages', 9876, 'detail.5.destinataire.');
    writeEntry(ld.ctx, listKey, 'messages', 9876, { received: [{ id: 5, read: false }] }, false);
    writeEntry(ld.ctx, detailKey, 'messages', 9876, { id: 5, read: false }, false);

    globalThis.fetch = async () => jsonResponse({ success: true });
    await ld.messages.markAsRead([5]);

    expect((ld.ctx.cacheMem.get(listKey)!.value as any).received[0].read).toBe(true);
    // The detail entry is not a list: markAsRead must leave it alone.
    expect((ld.ctx.cacheMem.get(detailKey)!.value as any).read).toBe(false);
  });

  test('the patch timestamps the entry with the injected clock', async () => {
    const ld = loggedIn();
    const key = keyFor('homework', 9876, 'index');
    writeEntry(ld.ctx, key, 'homework', 9876, { list: [{ idDevoir: 7, effectue: false }] }, false);

    // Pin the clock far from the wall clock: with Date.now() the assertion below
    // would fail, which is exactly the bug this guards.
    let now = 1_000_000;
    ld.ctx.clock = () => now;

    globalThis.fetch = async () => jsonResponse({ success: true });
    await ld.homework.markAsDone([7]);

    expect(ld.ctx.cacheMem.get(key)!.fetchedAt).toBe(1_000_000);

    now = 2_000_000;
    await ld.homework.markAsUndone([7]);
    expect(ld.ctx.cacheMem.get(key)!.fetchedAt).toBe(2_000_000);
  });

  test('a mutation whose payload the predicate rejects leaves the cache alone', async () => {
    const ld = loggedIn();
    const key = keyFor('homework', 9876, 'index');
    writeEntry(ld.ctx, key, 'homework', 9876, { list: [{ idDevoir: 7, effectue: false }] }, false);
    ld.ctx.clock = () => 42;
    const before = ld.ctx.cacheMem.get(key)!.fetchedAt;

    globalThis.fetch = async () => jsonResponse({ success: true });
    // Already false: nothing changes, so the entry must not be re-stamped.
    await ld.homework.markAsUndone([7]);

    expect(ld.ctx.cacheMem.get(key)!.fetchedAt).toBe(before);
  });

  test('the mutation request body is unchanged', async () => {
    const ld = loggedIn();
    const seen: any[] = [];
    globalThis.fetch = async (_input, init) => {
      seen.push({ method: init?.method, body: parseBody(init) });
      return jsonResponse({ success: true });
    };

    await ld.homework.markAsDone([1, 2]);
    expect(seen).toEqual([
      {
        method: 'POST',
        body: { idDevoirsEffectues: [1, 2], idDevoirsNonEffectues: [] },
      },
    ]);
  });
});
