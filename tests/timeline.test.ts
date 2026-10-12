// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Litedirecte } from '../src/index';
import { createTestClient, seedSession, testAccount } from './setup';

function encodeBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

describe('Timeline Module', () => {
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

  it('fetches personal timeline successfully', async () => {
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
          data: [
            {
              id: 111,
              typeElement: 'MESSAGE',
              titre: 'Class meeting',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const result = await ld.timeline.getTimeline();

    expect(requests.length).toBe(1);
    expect(requests[0].url).toContain('/eleves/9876/timeline.awp');
    expect(result.length).toBe(1);
    expect(result[0].id).toBe(111);
    expect(result[0].typeElement).toBe('MESSAGE');
    expect(result[0].titre).toBe('Class meeting');
  });

  it('fetches common timeline and decodes sticky notes', async () => {
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
            postits: [
              {
                id: 222,
                contenu: encodeBase64('Important reminder!'),
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const result: any = await ld.timeline.getCommonTimeline();

    expect(requests.length).toBe(1);
    expect(requests[0].url).toContain('/E/9876/timelineAccueilCommun.awp');
    expect(result.postits).toBeDefined();
    expect(result.postits[0].id).toBe(222);
    expect(result.postits[0].contenu).toBe('Important reminder!');
  });

  it('decodes chunked (multi-line) base64 sticky notes', async () => {
    const html =
      '<div><p><strong>Sortie scolaire</strong> : prévoir pique-nique, gourde et crème solaire. Rendez-vous à 8h00 devant le portail.</p></div>';
    const chunked = encodeBase64(html).replace(/(.{76})/g, '$1\r\n');

    globalThis.fetch = async (input) => {
      requests.push({ url: input.toString(), method: 'POST', body: undefined });

      return new Response(
        JSON.stringify({
          code: 200,
          message: '',
          data: {
            evenements: [],
            postits: [{ id: 333, contenu: chunked }],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const result: any = await ld.timeline.getCommonTimeline();

    expect(result.postits[0].id).toBe(333);
    expect(result.postits[0].contenu).toBe(html);
  });

  it('runs correlator analysis on grades and attendance', async () => {
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

      if (urlStr.includes('notes.awp')) {
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
                  dateSaisie: '2023-10-15',
                  codeMatiere: 'MATHS',
                  libelleMatiere: 'Mathematics',
                },
                {
                  valeur: '15',
                  noteSur: '20',
                  coef: '1',
                  dateSaisie: '2023-10-16',
                  codeMatiere: 'MATHS',
                  libelleMatiere: 'Mathematics',
                },
                {
                  valeur: '16',
                  noteSur: '20',
                  coef: '1',
                  dateSaisie: '2023-10-17',
                  codeMatiere: 'MATHS',
                  libelleMatiere: 'Mathematics',
                },
                {
                  valeur: '17',
                  noteSur: '20',
                  coef: '1',
                  dateSaisie: '2023-10-18',
                  codeMatiere: 'MATHS',
                  libelleMatiere: 'Mathematics',
                },
                {
                  valeur: '19',
                  noteSur: '20',
                  coef: '1',
                  dateSaisie: '2023-10-19',
                  codeMatiere: 'MATHS',
                  libelleMatiere: 'Mathematics',
                },
              ],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      } else if (urlStr.includes('viescolaire.awp')) {
        return new Response(
          JSON.stringify({
            code: 200,
            message: '',
            data: {
              absences: [],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response(JSON.stringify({ code: 404 }), { status: 404 });
    };

    const correlations = await ld.grades.correlate();

    expect(requests.length).toBe(1);
    expect(correlations.length).toBe(2);

    const trend = correlations.find((c) => c.type === 'gradeTrend');
    expect(trend).toBeDefined();
    expect(trend!.subject).toBe('Mathematics');
    expect(trend!.data.average).toBe(17);

    const dayPattern = correlations.find((c) => c.type === 'gradeVsDayOfWeek');
    expect(dayPattern).toBeDefined();
    expect(dayPattern!.subject).toBe('Mathematics');
    expect(dayPattern!.observations).toBe(5);
  });

  it('E5: day names are English regardless of the dayjs locale', async () => {
    const dayjs = (await import('dayjs')).default;
    await import('dayjs/locale/fr');
    const prev = dayjs.locale();
    dayjs.locale('fr');
    try {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            code: 200,
            message: '',
            data: {
              notes: [15, 16, 14, 17, 18].map((v, i) => ({
                valeur: String(v),
                noteSur: '20',
                libelleMatiere: 'Maths',
                // 2023-10-16 is a Monday; consecutive days follow.
                date: `2023-10-${16 + i}`,
              })),
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      const correlations = await ld.grades.correlate();
      const dayPattern = correlations.find((c) => c.type === 'gradeVsDayOfWeek');
      expect(dayPattern).toBeDefined();
      expect(Object.keys(dayPattern!.data).sort()).toEqual(
        ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].sort(),
      );
    } finally {
      dayjs.locale(prev);
    }
  });
});
