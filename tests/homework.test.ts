// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Litedirecte } from '../src/index';
import { createTestClient, seedSession, testAccount } from './setup';
import { EdValidationError } from '../src/core/errors';

function encodeBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

describe('Homework Module', () => {
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

  it('fetches basic homework list without content', async () => {
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
            '2023-10-15': [
              {
                idDevoir: 1,
                matiere: 'MATHS',
                effectue: '0',
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const result = await ld.homework.getHomework();

    expect(requests.length).toBe(1);
    expect(requests[0].url).toContain('/Eleves/9876/cahierdetexte.awp');
    expect(result['2023-10-15']).toBeDefined();
    expect(result['2023-10-15'][0].idDevoir).toBe(1);
    expect(result['2023-10-15'][0].effectue).toBe('0');
  });

  it('fetches homework details for a date via getHomeworkForDate and decodes Base64 fields', async () => {
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
            subjects: [
              {
                matiere: 'Maths',
                aFaire: {
                  contenu: encodeBase64('Solve equations'),
                },
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const result = await ld.homework.getHomeworkForDate('2023-10-15');

    expect(requests.length).toBe(1);
    expect(requests[0].url).toContain('/Eleves/9876/cahierdetexte/2023-10-15.awp');

    expect(result.subjects).toBeDefined();
    expect(result.subjects[0].matiere).toBe('Maths');
    expect(result.subjects[0].aFaire.contenu).toBe('Solve equations');
  });

  it('ignores the removed withContent option: getHomework() stays a single request', async () => {
    globalThis.fetch = async (input, init) => {
      const urlStr = input.toString();
      requests.push({ url: urlStr, method: init?.method || 'GET', body: undefined });
      return new Response(
        JSON.stringify({
          code: 200,
          message: '',
          data: { '2023-10-15': [{ idDevoir: 1, matiere: 'Maths' }] },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const result = await ld.homework.getHomework({ withContent: true } as any);

    expect(requests.length).toBe(1);
    expect(result['2023-10-15'][0].idDevoir).toBe(1);
  });

  it('throws error for invalid date in getHomeworkForDate', async () => {
    await expect(ld.homework.getHomeworkForDate('invalid-date')).rejects.toThrow(EdValidationError);
  });

  it('D2: rejects non-positive-integer homework ids without requesting', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response(JSON.stringify({ code: 200, message: '', data: {} }), { status: 200 });
    };
    await expect(ld.homework.markAsDone([0])).rejects.toThrow(EdValidationError);
    await expect(ld.homework.markAsDone([1.5])).rejects.toThrow(EdValidationError);
    await expect(ld.homework.markAsUndone([-3])).rejects.toThrow(EdValidationError);
    expect(calls).toBe(0);
  });

  it('marks homework as done', async () => {
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

    const result = await ld.homework.markAsDone([1, 2]);

    expect(requests.length).toBe(1);
    expect(requests[0].url).toContain('/Eleves/9876/cahierdetexte.awp');
    expect(requests[0].body).toEqual({
      idDevoirsEffectues: [1, 2],
      idDevoirsNonEffectues: [],
    });
    expect(result.success).toBe(true);
  });

  it('marks homework as not done', async () => {
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

    const result = await ld.homework.markAsUndone([3, 4]);

    expect(requests.length).toBe(1);
    expect(requests[0].url).toContain('/Eleves/9876/cahierdetexte.awp');
    expect(requests[0].body).toEqual({
      idDevoirsEffectues: [],
      idDevoirsNonEffectues: [3, 4],
    });
    expect(result.success).toBe(true);
  });

  it('posts a homework comment successfully and encodes the message payload in base64', async () => {
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
            id: 12345,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const result = await ld.homework.sendHomeworkComment(55442, 'Hello comment!');

    expect(requests.length).toBe(1);
    expect(requests[0].url).toContain('/eleves/9876/afaire/commentaires.awp');
    expect(requests[0].body).toEqual({
      idContenu: 55442,
      message: encodeBase64('Hello comment!'),
    });
    expect(result.id).toBe(12345);
  });
});
