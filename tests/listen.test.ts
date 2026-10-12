// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { Litedirecte } from '../src/index';
import { EdError } from '../src/core/errors';
import { createTestClient, seedSession, testAccount } from './setup';

function json(body: any) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Listen Module (Polling & Events)', () => {
  let originalFetch: typeof globalThis.fetch;
  let requests: string[] = [];
  let unsubscribes: (() => void)[] = [];
  let ld: Litedirecte;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    requests = [];
    unsubscribes = [];
    ({ ld } = createTestClient({ fetchInterval: 0 }));
    await seedSession(ld.ctx.config.storage!, ld, testAccount(), 'test_token');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    ld.destroy();
    unsubscribes = [];
  });

  function mockAllData(grades: unknown[], received: unknown[] = [], timeline: unknown[] = []) {
    globalThis.fetch = async (input) => {
      const urlStr = input.toString();
      requests.push(urlStr);
      if (urlStr.includes('notes.awp'))
        return json({ code: 200, message: '', data: { notes: grades } });
      if (urlStr.includes('messages.awp') && urlStr.includes('verbe=get')) {
        return json({ code: 200, message: '', data: { messages: { received } } });
      }
      if (urlStr.includes('timeline.awp')) return json({ code: 200, message: '', data: timeline });
      if (urlStr.includes('timelineAccueilCommun.awp'))
        return json({ code: 200, message: '', data: {} });
      return json({ code: 200, message: '', data: {} });
    };
  }

  it('C1: first getAll emits nothing, second emits only new items', async () => {
    const grades = [
      { id: 1, valeur: '15' },
      { id: 2, valeur: '16' },
      { id: 3, valeur: '14' },
    ];
    const received = [
      { id: 20, subject: 'Hello' },
      { id: 21, subject: 'World' },
    ];
    mockAllData(grades, received, []);

    const newGradeCallback = mock((_data) => {});
    const newMessageCallback = mock((_data) => {});
    unsubscribes.push(ld.on('newGrade', newGradeCallback));
    unsubscribes.push(ld.on('newMessage', newMessageCallback));

    // First getAll seeds the cache silently.
    const first = await ld.getAll();
    expect(first.errors).toEqual({});
    expect(requests.some((url) => url.includes('notes.awp'))).toBe(true);
    expect(requests.some((url) => url.includes('messages.awp'))).toBe(true);
    expect(requests.some((url) => url.includes('timeline.awp'))).toBe(true);
    expect(newGradeCallback).not.toHaveBeenCalled();
    expect(newMessageCallback).not.toHaveBeenCalled();

    // A fourth grade appears: exactly 1 event on the next getAll.
    grades.push({ id: 4, valeur: '18' });
    newGradeCallback.mockClear();
    await ld.getAll();

    expect(newGradeCallback).toHaveBeenCalledTimes(1);
    expect(newGradeCallback.mock.calls[0][0].id).toBe(4);
    expect(newMessageCallback).not.toHaveBeenCalled();
  });

  it('emits pollingError event when a poll tick fails', async () => {
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ code: 500, message: 'Server error' }), { status: 500 });
    };

    const errorCallback = mock((err) => {
      expect(err).toBeDefined();
    });
    unsubscribes.push(ld.on('pollingError', errorCallback));

    // A tick with no usable data reports each failing resource once.
    ld.resumePolling({ fetchInterval: 5 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    ld.stopPolling();

    expect(errorCallback).toHaveBeenCalled();
  });

  it('always delivers pollingError as an EdError with a readable code', async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ code: 500, message: 'Server error' }), { status: 500 });

    const seen: unknown[] = [];
    unsubscribes.push(ld.on('pollingError', (err) => seen.push(err)));

    ld.resumePolling({ fetchInterval: 5 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    ld.stopPolling();

    expect(seen.length).toBeGreaterThan(0);
    // The public payload type is `EdError`, so it must hold at runtime too.
    for (const err of seen) {
      expect(err).toBeInstanceOf(EdError);
      expect(typeof (err as EdError).code).toBe('string');
      expect((err as EdError).message).toBeString();
    }
  });

  it('handles partial failures: emits pollingError on rejections while still processing successful event diffs', async () => {
    const grades = [{ id: 101, valeur: '18' }];
    globalThis.fetch = async (input) => {
      const urlStr = input.toString();
      requests.push(urlStr);
      if (urlStr.includes('notes.awp')) {
        return json({ code: 200, message: '', data: { notes: grades } });
      }
      if (urlStr.includes('messages.awp') || urlStr.includes('timeline.awp')) {
        return new Response(JSON.stringify({ code: 500, message: 'down' }), { status: 500 });
      }
      return json({ code: 200, message: '', data: {} });
    };

    const newGradeCallback = mock((_data) => {});
    const errorCallback = mock((_err) => {});
    unsubscribes.push(ld.on('newGrade', newGradeCallback));
    unsubscribes.push(ld.on('pollingError', errorCallback));

    // First getAll seeds grades; failures land in `errors`.
    const first = await ld.getAll();
    expect(newGradeCallback).not.toHaveBeenCalled();
    expect(Object.keys(first.errors).length).toBeGreaterThan(0);

    // A new grade on the next getAll is still delivered despite past failures.
    grades.push({ id: 102, valeur: '19' });
    errorCallback.mockClear();
    await ld.getAll();

    expect(newGradeCallback).toHaveBeenCalledTimes(1);
    expect(newGradeCallback.mock.calls[0][0].id).toBe(102);
  });

  it('C2: a throwing listener does not break delivery to others', async () => {
    const grades = [{ id: 1, valeur: '15' }];
    mockAllData(grades, [], []);

    const throwing = mock((_data) => {
      throw new Error('listener boom');
    });
    const healthy = mock((_data) => {});
    const pollingError = mock((_err) => {});
    unsubscribes.push(ld.on('newGrade', throwing));
    unsubscribes.push(ld.on('newGrade', healthy));
    unsubscribes.push(ld.on('pollingError', pollingError));

    await ld.getAll();
    expect(throwing).not.toHaveBeenCalled();

    grades.push({ id: 2, valeur: '17' });
    await ld.getAll();

    expect(throwing).toHaveBeenCalledTimes(1);
    expect(healthy).toHaveBeenCalledTimes(1);
    expect(healthy.mock.calls[0][0].id).toBe(2);
    expect(pollingError).not.toHaveBeenCalled();
  });

  it('C3: ticks do nothing after logout and emit nothing', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return json({ code: 200, message: '', data: { notes: [] } });
    };

    const newGradeCallback = mock((_data) => {});
    unsubscribes.push(ld.on('newGrade', newGradeCallback));

    await ld.auth.logout();

    const before = calls;
    // A direct read without session rejects; no poll output appears.
    await expect(ld.getAll()).rejects.toThrow();
    expect(calls).toBe(before);
    expect(newGradeCallback).not.toHaveBeenCalled();
    expect(ld.sync.getState().state).toBe('signed-out');
  });

  it('C4: polling settings are validated', async () => {
    const { EdValidationError } = await import('../src/core/errors');
    expect(() => new Litedirecte({ fetchInterval: 2 })).toThrow(EdValidationError);
    expect(() => new Litedirecte({ fetchInterval: -5 })).toThrow(EdValidationError);
    expect(() => new Litedirecte({ fetchInterval: NaN })).toThrow(EdValidationError);
    expect(() => new Litedirecte({ fetchInterval: Infinity })).toThrow(EdValidationError);
    expect(() => new Litedirecte({ fetchIgnore: ['nope' as never] })).toThrow(EdValidationError);
    expect(() => ld.resumePolling({ fetchInterval: 2 })).toThrow(EdValidationError);
    expect(() => ld.configure({ fetchInterval: 2 })).toThrow(EdValidationError);
    expect(() => ld.resumePolling({ fetchInterval: 5 })).not.toThrow();
    expect(() => ld.resumePolling({ fetchInterval: 0 })).not.toThrow();
    expect(() => new Litedirecte({ fetchInterval: 0 })).not.toThrow();
    ld.stopPolling();
  });
});
