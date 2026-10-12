// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Litedirecte } from '../src/index';
import { createTestClient, seedSession, testAccount } from './setup';
import { EdValidationError } from '../src/core/errors';
import type { CloudNode } from '../src/types';

describe('Cloud Module', () => {
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

  it('gets cloud nodes with custom depth', async () => {
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
          data: [
            {
              id: 'node_1',
              libelle: 'My Folder',
              type: 'folder',
              children: [],
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const result = await ld.cloud.getCloud({ depth: 4 });

    expect(lastRequest).toBeDefined();
    expect(lastRequest!.url).toContain('/cloud/E/9876.awp');
    expect(lastRequest!.url).toContain('verbe=get');
    expect(lastRequest!.body).toEqual({ profondeur: 4 });
    expect(result.length).toBe(1);
    expect((result[0] as any).libelle).toBe('My Folder');
  });

  it('creates a new folder under a parent node', async () => {
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
            id: 'node_new',
            libelle: 'New Folder',
            type: 'folder',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const parentNode: CloudNode = {
      id: 'parent_id',
      type: 'folder',
      libelle: 'Parent',
    } as any;

    const result = await ld.cloud.createFolder('New Folder', parentNode);

    expect(lastRequest).toBeDefined();
    expect(lastRequest!.url).toContain('/cloud/E/9876.awp');
    expect(lastRequest!.url).toContain('verbe=post');
    expect(lastRequest!.body).toEqual({
      parentNode,
      libelle: 'New Folder',
      typeRessource: 'folder',
    });
    expect(result.id).toBe('node_new');
  });

  it('deletes nodes', async () => {
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

    const nodesToDelete: CloudNode[] = [
      { id: 'node_to_delete', type: 'file', libelle: 'Doc.pdf' } as any,
    ];

    const result = await ld.cloud.deleteNodes(nodesToDelete);

    expect(lastRequest).toBeDefined();
    expect(lastRequest!.url).toContain('/cloud/E/9876/visibility.awp');
    expect(lastRequest!.url).toContain('verbe=delete');
    expect(lastRequest!.body).toEqual({ tabNodes: nodesToDelete });
    expect(result.success).toBe(true);
  });
});

describe('Cloud Module D2 validation', () => {
  it('rejects out-of-range depth without requesting', async () => {
    const { ld: ld2, storage } = createTestClient();
    await seedSession(storage, ld2, testAccount({ modules: [] }), 'tok');
    let calls = 0;
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ code: 200, message: '', data: [] }), { status: 200 });
    }) as typeof fetch;
    try {
      await expect(ld2.cloud.getCloud({ depth: 0 })).rejects.toThrow(EdValidationError);
      await expect(ld2.cloud.getCloud({ depth: 11 })).rejects.toThrow(EdValidationError);
      await expect(ld2.cloud.getCloud({ depth: 2.5 })).rejects.toThrow(EdValidationError);
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = orig;
      ld2.destroy();
    }
  });
});
