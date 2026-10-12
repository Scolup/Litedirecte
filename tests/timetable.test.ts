// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import type { Litedirecte } from '../src/index';
import { createTestClient, seedSession, testAccount } from './setup';
import { EdValidationError } from '../src/core/errors';

describe('Timetable Module', () => {
  let originalFetch: typeof globalThis.fetch;
  let requests: { url: string; method: string; body: any }[] = [];
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

  afterEach(() => {
    globalThis.fetch = originalFetch;
    ld.destroy();
  });

  it('fetches timetable with custom dates', async () => {
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
            timetable: [
              {
                id: 1,
                codeMatiere: 'MATHS',
                matiere: 'Mathematics',
                start_date: '2023-10-15 08:30',
                end_date: '2023-10-15 10:30',
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const result = await ld.timetable.getTimetable({
      startDate: '2023-10-15',
      endDate: '2023-10-16',
    });

    expect(requests.length).toBe(1);
    expect(requests[0].url).toContain('/E/9876/emploidutemps.awp');
    expect(requests[0].body).toEqual({
      dateDebut: '2023-10-15',
      dateFin: '2023-10-16',
      avecTrous: false,
    });
    expect(result.timetable).toBeDefined();
    expect(result.timetable[0].id).toBe(1);
    expect(result.timetable[0].codeMatiere).toBe('MATHS');
    expect(result.timetable[0].matiere).toBe('Mathematics');
  });

  it('retrieves ICAL timetable URL', async () => {
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
            url: 'ical_url_hash',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const url = await ld.timetable.getTimetableIcalUrl();

    expect(requests.length).toBe(1);
    expect(requests[0].url).toContain('/ical/E/9876/url.awp');
    expect(url).toBe('https://api.ecoledirecte.com/v3/ical_url_hash');
  });

  it('D2: rejects invalid dates without requesting', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response(JSON.stringify({ code: 200, message: '', data: {} }), { status: 200 });
    };
    await expect(ld.timetable.getTimetable({ startDate: 'not-a-date' })).rejects.toThrow(
      EdValidationError,
    );
    await expect(ld.timetable.getTimetable({ endDate: 'not-a-date' })).rejects.toThrow(
      EdValidationError,
    );
    await expect(
      ld.timetable.getTimetable({ startDate: '2023-10-16', endDate: '2023-10-15' }),
    ).rejects.toThrow(EdValidationError);
    expect(calls).toBe(0);
  });
});
