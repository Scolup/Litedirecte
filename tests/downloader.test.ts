// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Litedirecte } from '../src/index';
import { createTestClient, seedSession, testAccount } from './setup';

describe('Downloader Module', () => {
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

  it('downloads file in buffer format by default', async () => {
    const rawBuffer = new TextEncoder().encode('file_content').buffer;

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

      return new Response(rawBuffer, {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
      });
    };

    const result = await ld.downloads.download({
      params: { fileId: 123 },
    });

    expect(lastRequest).toBeDefined();
    expect(lastRequest!.url).toContain('telechargement.awp?verbe=get');
    expect(lastRequest!.body).toEqual('fileId=123&token=test_token');
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(result as ArrayBuffer)).toEqual(new Uint8Array(rawBuffer));
  });

  it('downloads file in blob format', async () => {
    globalThis.fetch = async (input, init) => {
      return new Response('some_content', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    };

    const result = await ld.downloads.download({ as: 'blob' });

    expect(result).toBeInstanceOf(Blob);
    const text = await (result as Blob).text();
    expect(text).toBe('some_content');
  });

  it('downloads file in stream format', async () => {
    globalThis.fetch = async (input, init) => {
      return new Response('some_stream_content', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    };

    const result = await ld.downloads.download({ as: 'stream' });

    expect(result).toBeInstanceOf(ReadableStream);
  });

  it('downloads active account photo in buffer format', async () => {
    const rawBuffer = new TextEncoder().encode('photo_content').buffer;

    globalThis.fetch = async (input, init) => {
      const urlStr = input.toString();
      const method = init?.method || 'GET';
      lastRequest = { url: urlStr, method, body: undefined };

      return new Response(rawBuffer, {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg' },
      });
    };

    const result = await ld.downloads.downloadPhoto();

    expect(lastRequest).toBeDefined();
    expect(lastRequest!.url).toBe('https://example.com/photo.jpg');
    expect(lastRequest!.method).toBe('GET');
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(result as ArrayBuffer)).toEqual(new Uint8Array(rawBuffer));
  });

  it('downloads active account photo with protocol-relative URL', async () => {
    ld.ctx.account = testAccount({
      profile: { sexe: 'M', photo: '//doc1.ecoledirecte.com/PhotoEleves/photo.jpg' },
    });
    const rawBuffer = new TextEncoder().encode('photo_content_pr').buffer;

    globalThis.fetch = async (input, init) => {
      const urlStr = input.toString();
      const method = init?.method || 'GET';
      lastRequest = { url: urlStr, method, body: undefined };

      return new Response(rawBuffer, {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg' },
      });
    };

    const result = await ld.downloads.downloadPhoto();

    expect(lastRequest).toBeDefined();
    expect(lastRequest!.url).toBe('https://doc1.ecoledirecte.com/PhotoEleves/photo.jpg');
    expect(lastRequest!.method).toBe('GET');
    expect(result).toBeInstanceOf(ArrayBuffer);
  });

  it('returns null if active account has no photo', async () => {
    ld.ctx.account = testAccount({ profile: { sexe: 'M', photo: '' } });

    const result = await ld.downloads.downloadPhoto();
    expect(result).toBeNull();
  });

  it('B1: download rejects HTTP error pages instead of returning them', async () => {
    for (const status of [404, 500]) {
      globalThis.fetch = async () =>
        new Response('<html>error page</html>', {
          status,
          headers: { 'Content-Type': 'text/html' },
        });
      await expect(ld.downloads.download({ params: { fileId: 1 } })).rejects.toThrow();
    }
  });
});
