// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import type { Litedirecte } from '../src/index';
import { createTestClient, seedSession, testAccount } from './setup';

describe('Documents Module', () => {
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

  it('fetches documents and transforms fields correctly', async () => {
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
            factures: [
              {
                id: 101,
                libelle: 'Invoice Oct',
                taille: 1542,
              },
            ],
            administratifs: [
              {
                id: 202,
                libelle: 'Rules.pdf',
                signatureDemandee: '1',
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const result = await ld.documents.getDocuments();

    expect(lastRequest).toBeDefined();
    expect(lastRequest!.url).toContain('/elevesDocuments.awp');
    expect(lastRequest!.method).toBe('POST');

    expect(result.factures).toBeDefined();
    expect(result.factures[0].id).toBe(101);
    expect(result.factures[0].libelle).toBe('Invoice Oct');
    expect(result.factures[0].taille).toBe(1542);

    expect(result.administratifs).toBeDefined();
    expect(result.administratifs![0].id).toBe(202);
    expect(result.administratifs![0].libelle).toBe('Rules.pdf');
    expect(result.administratifs![0].signatureDemandee).toBe('1');
  });
});
