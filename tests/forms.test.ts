// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Litedirecte } from '../src/index';
import { createTestClient, seedSession, testAccount } from './setup';
import { EdValidationError } from '../src/core/errors';

describe('Forms Module', () => {
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

  it('fetches associations of QCMS', async () => {
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
            associations: [
              {
                id: 11,
                idQcm: 22,
                titre: 'Math Test',
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const result = await ld.qcms.getQcms();

    expect(lastRequest).toBeDefined();
    expect(lastRequest!.url).toContain('/eleves/9876/qcms/0/associations.awp');
    expect(result.associations).toBeDefined();
    expect(result.associations![0].id).toBe(11);
    expect(result.associations![0].idQcm).toBe(22);
    expect(result.associations![0].titre).toBe('Math Test');
  });

  it('gets detail of a QCM', async () => {
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
            idQcm: 22,
            questions: [
              {
                id: 123,
                libelle: 'What is 2+2?',
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const result = await ld.qcms.getQcmDetail(22, 11);

    expect(lastRequest).toBeDefined();
    expect(lastRequest!.url).toContain('/eleves/9876/qcms/22/associations/11.awp');
    expect(lastRequest!.body).toEqual({ anneeQCMs: '' });
    expect(result.idQcm).toBe(22);
    expect(result.questions[0].id).toBe(123);
    expect(result.questions[0].libelle).toBe('What is 2+2?');
  });

  it('updates QCM status', async () => {
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
            success: true,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const result = await ld.qcms.updateQcmStatus(22, 11, 444, 'updateStartDate');

    expect(lastRequest).toBeDefined();
    expect(lastRequest!.url).toContain('/eleves/9876/qcms/22/associations/11/participants/444.awp');
    expect(lastRequest!.body).toEqual({ action: 'updateStartDate' });
    expect(result.success).toBe(true);
  });

  it('submits QCM answers', async () => {
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
            success: true,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const result = await ld.qcms.submitQcmAnswer({
      idQcm: 22,
      idAssociation: 11,
      idParticipant: 444,
      idReponse: 555,
      idQuestion: 123,
      choiceIds: [1, 2],
    });

    expect(lastRequest).toBeDefined();
    expect(lastRequest!.url).toContain(
      '/eleves/9876/qcms/22/associations/11/participants/444/reponse/555.awp',
    );
    expect(lastRequest!.body).toEqual({
      reponse: {
        id: 555,
        idQuestion: 123,
        idParticipant: 444,
        choix: [1, 2],
      },
    });
    expect(result.success).toBe(true);
  });
});

describe('Forms Module D2 validation', () => {
  it('rejects non-positive-integer ids without requesting', async () => {
    const { ld: ld2, storage } = createTestClient();
    await seedSession(storage, ld2, testAccount({ modules: [] }), 'tok');
    let calls = 0;
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ code: 200, message: '', data: {} }), { status: 200 });
    }) as typeof fetch;
    try {
      await expect(ld2.qcms.getQcmDetail(0, 1)).rejects.toThrow(EdValidationError);
      await expect(ld2.qcms.getQcmDetail(1.5, 1)).rejects.toThrow(EdValidationError);
      await expect(ld2.qcms.updateQcmStatus(1, 0, 1, 'updateStartDate')).rejects.toThrow(
        EdValidationError,
      );
      await expect(
        ld2.qcms.submitQcmAnswer({
          idQcm: 1,
          idAssociation: 1,
          idParticipant: 1,
          idReponse: -2,
          idQuestion: 1,
          choiceIds: [],
        }),
      ).rejects.toThrow(EdValidationError);
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = orig;
      ld2.destroy();
    }
  });
});
