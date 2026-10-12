// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import type { Litedirecte } from '../src/index';
import { createTestClient, seedSession, testAccount } from './setup';

describe('Grades Module', () => {
  let originalFetch: typeof globalThis.fetch;
  let lastRequest: { url: string; method: string; body: any } | null = null;
  let ld: Litedirecte;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    lastRequest = null;
    ({ ld } = createTestClient());
    await seedSession(ld.ctx.config.storage!, ld, testAccount(), 'test_token');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    ld.destroy();
  });

  it('fetches grades and transforms correctly with no periodId', async () => {
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
      lastRequest = { url: urlStr, method, body: parsedBody };

      return new Response(
        JSON.stringify({
          code: 200,
          message: '',
          data: {
            notes: [
              {
                valeur: '18',
                noteSur: '20',
                coef: '1',
                enLettre: false,
                date: '2023-11-20',
                codeMatiere: 'MATH',
                libelleMatiere: 'Mathématiques',
                codePeriode: 'A01',
                dateSaisie: '2023-11-21',
              },
            ],
            periodes: [
              {
                idPeriode: 'A01',
                codePeriode: 'P1',
                periode: 'Trimestre 1',
                annuel: false,
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const result = await ld.grades.getGrades();

    expect(lastRequest).toBeDefined();
    expect(lastRequest!.url).toContain('/eleves/9876/notes.awp');
    expect(lastRequest!.url).toContain('verbe=get');
    expect(lastRequest!.method).toBe('POST');
    expect(lastRequest!.body).toEqual({ anneeScolaire: '' });

    expect(result.notes).toBeDefined();
    expect(result.notes.length).toBe(1);
    expect(result.notes[0].valeur).toBe('18');
    expect(result.notes[0].date).toBeInstanceOf(Date);
    expect(result.notes[0].date.getFullYear()).toBe(2023);
    expect(result.notes[0].date.getMonth()).toBe(10); // November is 10
    expect(result.notes[0].dateSaisie).toBeInstanceOf(Date);

    expect(result.periodes).toBeDefined();
    expect(result.periodes!.length).toBe(1);
    expect(result.periodes![0].idPeriode).toBe('A01');
  });

  it('fetches grades and sends the correct periodId', async () => {
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
      lastRequest = { url: urlStr, method, body: parsedBody };

      return new Response(
        JSON.stringify({
          code: 200,
          message: '',
          data: {
            notes: [],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const result = await ld.grades.getGrades({ periodId: '2023-2024' });

    expect(lastRequest).toBeDefined();
    expect(lastRequest!.url).toContain('/eleves/9876/notes.awp');
    expect(lastRequest!.body).toEqual({ anneeScolaire: '2023-2024' });
    expect(result.notes).toEqual([]);
  });

  it('works when destructured', async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ code: 200, message: '', data: { notes: [] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    const { getGrades } = ld.grades;
    const result = await getGrades();
    expect(result.notes).toEqual([]);
  });
});
