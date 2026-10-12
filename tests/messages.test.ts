// © 2026 typeof (Scolup) | Licensed under AGPL 3.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Litedirecte } from '../src/index';
import { createTestClient, seedSession, testAccount } from './setup';
import { EdValidationError } from '../src/core/errors';

describe('Messages Module', () => {
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

  it('fetches message list', async () => {
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
            messages: {
              received: [
                {
                  id: 111,
                  subject: 'Welcome',
                  mtype: 'received',
                },
              ],
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const result = await ld.messages.getMessages();

    expect(requests.length).toBe(1);
    expect(requests[0].url).toContain('/eleves/9876/messages.awp');
    expect(requests[0].body.idClasseur).toBeUndefined();
    expect(result.messages?.received).toBeDefined();
    expect(result.messages!.received![0].id).toBe(111);
    expect(result.messages!.received![0].subject).toBe('Welcome');
  });

  it('sends idClasseur as query parameter when folderId is provided', async () => {
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
            messages: {
              received: [],
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    await ld.messages.getMessages({ folderId: 42 });

    expect(requests.length).toBe(1);
    expect(requests[0].url).toContain('/eleves/9876/messages.awp');
    expect(requests[0].url).toContain('idClasseur=42');
    expect(requests[0].url).toContain('typeRecuperation=classeur');
    expect(requests[0].body.idClasseur).toBeUndefined();
  });

  it('sends year in body when year is valid', async () => {
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
          data: { messages: { received: [] } },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    await ld.messages.getMessages({ year: '2024-2025' });

    expect(requests.length).toBe(1);
    expect(requests[0].body.anneeMessages).toBe('2024-2025');
  });

  it('D3: sends empty year when year is missing, rejects invalid school years', async () => {
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
          data: { messages: { received: [] } },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    await ld.messages.getMessages();
    expect(requests[0].body.anneeMessages).toBe('');

    // Normalized keys: a default `getMessages()` and `getMessages({ year: '' })`
    // are the same entry, so the second read is served from the cache.
    await ld.messages.getMessages({ year: '' });
    expect(requests.length).toBe(1);

    // Anything else must be a strict consecutive school year.
    for (const bad of ['bad', '2026', '2027-2026', '2026-2028', '2024-2026', '1111-1111']) {
      await expect(ld.messages.getMessages({ year: bad })).rejects.toThrow(EdValidationError);
    }
    expect(requests.length).toBe(1);
  });

  it('sends year in body for getMessage when year is valid', async () => {
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

      return new Response(JSON.stringify({ code: 200, message: '', data: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    await ld.messages.getMessage(111, { year: '2024-2025' });
    expect(requests[0].body.anneeMessages).toBe('2024-2025');

    await expect(ld.messages.getMessage(111, { year: 'nope' })).rejects.toThrow(EdValidationError);

    await ld.messages.getMessage(111);
    expect(requests[1].body.anneeMessages).toBe('');
  });

  it('fetches one message body via getMessage in a single request', async () => {
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
            id: 111,
            subject: 'Welcome',
            contenu: Buffer.from('Hello World', 'utf-8').toString('base64'),
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const result = await ld.messages.getMessage(111);

    expect(requests.length).toBe(1);
    expect(requests[0].url).toContain('/eleves/9876/messages/111.awp');
    expect(result.contenu).toBe('Hello World');
  });

  it('getMessages() stays a single request: no detail fetch, no PUT', async () => {
    globalThis.fetch = async (input, init) => {
      const urlStr = input.toString();
      requests.push({ url: urlStr, method: init?.method || 'GET', body: undefined });
      return new Response(
        JSON.stringify({
          code: 200,
          message: '',
          data: {
            messages: {
              received: [
                { id: 111, subject: 'Unread msg', read: false },
                { id: 222, subject: 'Read msg', read: true },
              ],
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    // The removed withContent option has no effect anymore.
    const result = await ld.messages.getMessages({ withContent: true } as any);

    expect(requests.length).toBe(1);
    expect(requests[0].url).toContain('/eleves/9876/messages.awp');
    expect(result.messages!.received!).toHaveLength(2);
  });

  it('restores the unread state explicitly with markAsUnread after getMessage', async () => {
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

      if (urlStr.includes('messages.awp?verbe=put')) {
        return new Response(JSON.stringify({ code: 200, message: '', data: { success: true } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          code: 200,
          message: '',
          data: {
            id: 111,
            subject: 'Unread msg',
            contenu: Buffer.from('<p>body</p>', 'utf-8').toString('base64'),
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    // getMessage marks the message as read on the server...
    await ld.messages.getMessage(111);
    // ...and markAsUnread restores the unread state.
    await ld.messages.markAsUnread(111);

    expect(requests.length).toBe(2);
    const putRequests = requests.filter((r) => r.url.includes('messages.awp?verbe=put'));
    expect(putRequests.length).toBe(1);
    expect(putRequests[0].body.action).toBe('marquerCommeNonLu');
    expect(putRequests[0].body.ids).toEqual([111]);
  });

  it('decodes base64 message content in place, keeping the contenu key', async () => {
    globalThis.fetch = async (input, init) => {
      const urlStr = input.toString();
      if (urlStr.includes('messages/111.awp')) {
        return new Response(
          JSON.stringify({
            code: 200,
            message: '',
            data: {
              message: {
                id: 111,
                contenu: Buffer.from('<p>decoded body</p>', 'utf-8').toString('base64'),
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          code: 200,
          message: '',
          data: { messages: { received: [{ id: 111, subject: 'Welcome' }] } },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const result = await ld.messages.getMessage(111);
    const entry = (result as any).message as any;

    expect(entry.contenu).toBe('<p>decoded body</p>');
    expect(entry.content).toBeUndefined();
  });

  it('fetches the contact list for the logged-in account class', async () => {
    globalThis.fetch = async (input, init) => {
      const urlStr = input.toString();
      let parsedBody: any = undefined;
      if (init?.body) {
        const bodyStr = init.body.toString();
        parsedBody = bodyStr.startsWith('data=')
          ? JSON.parse(decodeURIComponent(bodyStr.substring(5)))
          : bodyStr;
      }
      requests.push({ url: urlStr, method: init?.method || 'GET', body: parsedBody });

      return new Response(
        JSON.stringify({
          code: 200,
          message: '',
          data: { contacts: [{ id: 233, type: 'P', nom: 'ZANNEUR' }] },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };
    ld.ctx.account = testAccount({
      profile: { sexe: 'M', photo: '', classe: { id: 17, code: 'T1', libelle: 'TERMINALE 1' } },
    });

    const result = await ld.messages.getContacts();

    expect(requests.length).toBe(1);
    expect(requests[0].url).toContain('/messagerie/contacts/professeurs.awp');
    expect(requests[0].url).toContain('idClasse=17');
    expect(requests[0].body).toEqual({});
    expect(result.contacts[0].id).toBe(233);
  });

  it('fetches staff contacts for an explicit class', async () => {
    globalThis.fetch = async (input, init) => {
      const urlStr = input.toString();
      let parsedBody: any = undefined;
      if (init?.body) {
        const bodyStr = init.body.toString();
        parsedBody = bodyStr.startsWith('data=')
          ? JSON.parse(decodeURIComponent(bodyStr.substring(5)))
          : bodyStr;
      }
      requests.push({ url: urlStr, method: init?.method || 'GET', body: parsedBody });

      return new Response(JSON.stringify({ code: 200, message: '', data: { contacts: [] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    ld.ctx.account = testAccount({ profile: { sexe: 'M', photo: '' } });

    await ld.messages.getContacts({ type: 'A', classId: 17 });

    expect(requests.length).toBe(1);
    expect(requests[0].url).toContain('/messagerie/contacts/personnels.awp');
    expect(requests[0].url).toContain('idClasse=17');
  });

  it('rejects a contact list when no class id is available', async () => {
    globalThis.fetch = async () => {
      requests.push({ url: 'unexpected', method: 'GET', body: undefined });
      return new Response(JSON.stringify({ code: 200, message: '', data: {} }), { status: 200 });
    };
    ld.ctx.account = testAccount({ profile: { sexe: 'M', photo: '' } });

    await expect(ld.messages.getContacts()).rejects.toBeInstanceOf(EdValidationError);
    expect(requests.length).toBe(0);
  });

  it('sends message successfully', async () => {
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

    const data = {
      subject: 'Hello',
      content: 'This is a test message',
      destinataires: ['TeacherA'],
    };

    const result = await ld.messages.sendMessage(data);

    expect(requests.length).toBe(1);
    expect(requests[0].url).toContain('/eleves/9876/messages.awp');
    expect(requests[0].body.message.subject).toBe('Hello');
    expect(result.success).toBe(true);
  });

  it('encodes accents as HTML entities so EcoleDirecte stores them intact', async () => {
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

    await ld.messages.sendMessage({
      subject: 'Absence',
      content: 'à moi et Paul, café',
      destinataires: ['TeacherA'],
    });

    const sent = requests[0].body.message.content as string;
    // The payload must stay pure ASCII: EcoleDirecte reads base64-decoded
    // bytes as Latin-1, so raw UTF-8 would arrive as mojibake (`é` → `Ã©`).
    expect(sent).toMatch(/^[A-Za-z0-9+/=]+$/);
    const decoded = Buffer.from(sent, 'base64').toString('utf-8');
    expect(decoded).toContain('&#224; moi et Paul, caf&#233;');
    // What the server sees through Latin-1 eyes stays readable HTML.
    expect(Buffer.from(sent, 'base64').toString('latin1')).toContain('&#224;');
  });

  it('uploads an attachment as multipart FormData with the file field', async () => {
    globalThis.fetch = async (input, init) => {
      const urlStr = input.toString();
      requests.push({ url: urlStr, method: init?.method || 'GET', body: init?.body });

      return new Response(
        JSON.stringify({
          code: 200,
          token: 'test_token',
          message: '\\\\STOCK-TMP\\tmp\\mock\\devoir.pdf',
          data: { unc: '\\\\STOCK-TMP\\tmp\\mock\\devoir.pdf', libelle: 'devoir.pdf' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const file = new File(['dummy'], 'devoir.pdf', { type: 'application/pdf' });
    const result = await ld.messages.uploadAttachment(file);

    expect(requests.length).toBe(1);
    expect(requests[0].url).toContain('/televersement.awp?verbe=post');
    const sent = requests[0].body as FormData;
    expect(sent instanceof FormData).toBe(true);
    const entry = sent.get('file') as File;
    expect(entry.name).toBe('devoir.pdf');
    expect(result.unc).toContain('STOCK-TMP');
    expect(result.libelle).toBe('devoir.pdf');
  });

  it('sends message files as unc references with transfertFiles', async () => {
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

    const result = await ld.messages.sendMessage({
      subject: 'Hello',
      content: 'See attached',
      destinataires: ['TeacherA'],
      files: [{ unc: '\\\\STOCK-TMP\\tmp\\mock\\devoir.pdf', libelle: 'devoir.pdf' }],
    });

    expect(requests.length).toBe(1);
    expect(requests[0].body.message.files).toEqual([
      {
        id: '0',
        libelle: 'devoir.pdf',
        displayText: 'devoir.pdf',
        unc: '\\\\STOCK-TMP\\tmp\\mock\\devoir.pdf',
      },
    ]);
    expect(requests[0].body.message.transfertFiles).toEqual([]);
    expect(result.success).toBe(true);
  });

  it('marks a single message as read', async () => {
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

      return new Response(JSON.stringify({ code: 200, message: '', data: { success: true } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const result = await ld.messages.markAsRead(12345);

    expect(requests.length).toBe(1);
    expect(requests[0].url).toContain('/eleves/9876/messages.awp?verbe=put');
    expect(requests[0].body.action).toBe('marquerCommeLu');
    expect(requests[0].body.ids).toEqual([12345]);
    expect(result.success).toBe(true);
  });

  it('marks multiple messages as unread', async () => {
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

      return new Response(JSON.stringify({ code: 200, message: '', data: { success: true } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const result = await ld.messages.markAsUnread([111, 222, 333]);

    expect(requests.length).toBe(1);
    expect(requests[0].url).toContain('/eleves/9876/messages.awp?verbe=put');
    expect(requests[0].body.action).toBe('marquerCommeNonLu');
    expect(requests[0].body.ids).toEqual([111, 222, 333]);
    expect(result.success).toBe(true);
  });

  it('rejects non-positive message ids', async () => {
    await expect(ld.messages.markAsRead(0)).rejects.toThrow();
    await expect(ld.messages.markAsUnread([-5])).rejects.toThrow();
  });

  it('D5: folder listing uses shared version and supports page option', async () => {
    globalThis.fetch = async (input, init) => {
      const urlStr = input.toString();
      requests.push({ url: urlStr, method: init?.method || 'GET', body: undefined });

      return new Response(
        JSON.stringify({ code: 200, message: '', data: { messages: { received: [] } } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    await ld.messages.getMessages({ folderId: 42 });
    const url = new URL(requests[0].url);
    expect(url.searchParams.get('page')).toBe('0');
    expect(url.searchParams.get('itemsPerPage')).toBe('100');
    expect(requests[0].url).not.toContain('7.12.1');

    await ld.messages.getMessages({ folderId: 42, page: 3 });
    expect(new URL(requests[1].url).searchParams.get('page')).toBe('3');

    await expect(ld.messages.getMessages({ folderId: 42, page: -1 })).rejects.toThrow(
      EdValidationError,
    );
    await expect(ld.messages.getMessages({ folderId: 42, page: 1.5 })).rejects.toThrow(
      EdValidationError,
    );
    expect(requests.length).toBe(2);
  });
});
// © 2026 typeof (Scolup) | Licensed under AGPL 3.
