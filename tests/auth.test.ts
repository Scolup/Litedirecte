// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { Litedirecte } from '../src/index';
import { createTestClient } from './setup';
import { EdAuthError } from '../src/core/errors';

function encodeBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

describe('Authentication Flow', () => {
  let originalFetch: typeof globalThis.fetch;
  let requests: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: any;
  }[] = [];
  let mockResponses: Map<
    string,
    (req: any) => {
      status: number;
      headers?: Record<string, string>;
      body: any;
    }
  > = new Map();
  let ld: Litedirecte;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    requests = [];
    mockResponses.clear();
    ({ ld } = createTestClient());

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = input.toString();
      const method = init?.method || 'GET';
      const headers: Record<string, string> = {};
      if (init?.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((value, key) => {
            headers[key] = value;
          });
        } else if (Array.isArray(init.headers)) {
          init.headers.forEach(([key, value]) => {
            headers[key] = value;
          });
        } else {
          Object.assign(headers, init.headers);
        }
      }

      let parsedBody: any = undefined;
      if (init?.body) {
        const bodyStr = init.body.toString();
        if (bodyStr.startsWith('data=')) {
          const jsonStr = decodeURIComponent(bodyStr.substring(5));
          try {
            parsedBody = JSON.parse(jsonStr);
          } catch {
            parsedBody = bodyStr;
          }
        } else {
          parsedBody = bodyStr;
        }
      }

      requests.push({ url: urlStr, method, headers, body: parsedBody });

      let matchedHandler = null;
      for (const [pattern, handler] of mockResponses.entries()) {
        if (urlStr.includes(pattern)) {
          matchedHandler = handler;
          break;
        }
      }

      if (matchedHandler) {
        const {
          status,
          headers: resHeaders,
          body,
        } = matchedHandler({ url: urlStr, method, headers, body: parsedBody });
        return new Response(JSON.stringify(body), {
          status,
          headers: new Headers({
            'Content-Type': 'application/json',
            ...resHeaders,
          }),
        });
      }

      return new Response(JSON.stringify({ code: 404, message: 'Not found' }), {
        status: 404,
        headers: new Headers({ 'Content-Type': 'application/json' }),
      });
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    ld.destroy();
  });

  const mockRawAccount = {
    idLogin: 1234567,
    id: 9876,
    uid: 'session_uid',
    identifiant: 'Test.user',
    typeCompte: 'E',
    prenom: 'John',
    nom: 'Doe',
    email: 'john.doe@example.com',
    nomEtablissement: 'Ecole Test',
    main: true,
    accesstoken: 'mocked_access_token',
    photo: 'https://example.com/photo.jpg',
    profile: {
      sexe: 'M',
      photo: 'https://example.com/photo.jpg',
    },
    modules: [{ code: 'NOTES', enable: 1, badge: 0, params: {} }],
  };

  const mockRawAccount2 = {
    idLogin: 1234567,
    id: 5555,
    uid: 'session_uid2',
    identifiant: 'Test.user2',
    typeCompte: 'E',
    prenom: 'Jane',
    nom: 'Doe',
    email: 'jane.doe@example.com',
    nomEtablissement: 'Ecole Test',
    main: false,
    accesstoken: 'mocked_access_token2',
    photo: 'https://example.com/photo2.jpg',
    profile: {
      sexe: 'F',
      photo: 'https://example.com/photo2.jpg',
    },
    modules: [{ code: 'NOTES', enable: 1, badge: 0, params: {} }],
  };

  it('performs a standard successful login', async () => {
    mockResponses.set('/login.awp?gtk=1', () => ({
      status: 200,
      headers: { 'set-cookie': 'GTK=mocked_gtk_value; Path=/' },
      body: { code: 200, token: '', message: '', data: {} },
    }));

    mockResponses.set('/login.awp?v=', (req) => {
      expect(req.headers['X-GTK']).toBe('mocked_gtk_value');
      expect(req.body.identifiant).toBe('testuser');
      expect(req.body.motdepasse).toBe('testpass');
      return {
        status: 200,
        headers: { 'X-Token': 'mocked_session_token' },
        body: {
          code: 200,
          token: 'mocked_session_token',
          message: '',
          data: {
            accounts: [mockRawAccount],
          },
        },
      };
    });

    const result = await ld.auth.login('testuser', 'testpass');

    expect(result.type).toBe('success');
    if (result.type === 'success') {
      expect(result.user.prenom).toBe('John');
      expect(result.user.nom).toBe('Doe');
      expect(result.token).toBe('mocked_session_token');
    }
    expect(ld.auth.getAccount()?.id).toBe(9876);
    expect(ld.auth.getLastTokenRefresh()).toBeDefined();

    // Login prefetches in the background: the two login requests come first.
    expect(requests.length).toBeGreaterThanOrEqual(2);
    expect(requests[0].url).toContain('gtk=1');
    expect(requests[1].url).toContain('login.awp?v=');
  });

  it('handles 2FA challenge flow successfully', async () => {
    mockResponses.set('/login.awp?gtk=1', () => ({
      status: 200,
      headers: { 'set-cookie': 'GTK=mocked_gtk_value; Path=/' },
      body: { code: 200, token: '', message: '', data: {} },
    }));

    mockResponses.set('/login.awp?v=', (req) => {
      if (req.body && req.body.cn === 'mocked_cn' && req.body.cv === 'mocked_cv') {
        return {
          status: 200,
          headers: { 'X-Token': 'final_session_token' },
          body: {
            code: 200,
            token: 'final_session_token',
            message: '',
            data: {
              accounts: [mockRawAccount],
            },
          },
        };
      }
      return {
        status: 200,
        headers: { '2fa-token': 't1', 'x-token': 'x1' },
        body: { code: 250, token: '', message: '2FA required', data: {} },
      };
    });

    mockResponses.set('/connexion/doubleauth.awp?verbe=get', () => ({
      status: 200,
      headers: { '2fa-token': 't2', 'x-token': 'x2' },
      body: {
        code: 200,
        token: '',
        message: '',
        data: {
          question: encodeBase64('What is your favorite color?'),
          propositions: [encodeBase64('Blue'), encodeBase64('Red'), encodeBase64('Green')],
        },
      },
    }));

    mockResponses.set('/connexion/doubleauth.awp?verbe=post', () => ({
      status: 200,
      headers: { '2fa-token': 't3', 'x-token': 'x3' },
      body: {
        code: 200,
        token: '',
        message: '',
        data: {
          cn: 'mocked_cn',
          cv: 'mocked_cv',
        },
      },
    }));

    const on2faRequired = mock((question, choices) => {
      expect(question).toBe('What is your favorite color?');
      expect(choices).toEqual(['Blue', 'Red', 'Green']);
      return 1;
    });

    const result = await ld.auth.login('testuser', 'testpass', { on2faRequired });

    expect(on2faRequired).toHaveBeenCalled();
    expect(result.type).toBe('success');
    if (result.type === 'success') {
      expect(result.token).toBe('final_session_token');
      expect(result.user.prenom).toBe('John');
    }
  });

  it('rejects the removed object login form and aliases at runtime without requesting', async () => {
    mockResponses.set('/login.awp?gtk=1', () => ({
      status: 200,
      headers: { 'set-cookie': 'GTK=mocked_gtk_value; Path=/' },
      body: { code: 200, token: '', message: '', data: {} },
    }));

    await expect(
      ld.auth.login({
        username: 'testuser_opt',
        password: 'testpass_opt',
      } as any),
    ).rejects.toThrow();
    await expect(
      ld.auth.login({ identifiant: 'testuser_opt', motdepasse: 'testpass_opt' } as any),
    ).rejects.toThrow();
    expect(requests.length).toBe(0);
  });

  it('handles 2FA choice selection by string option (case-insensitive)', async () => {
    mockResponses.set('/login.awp?gtk=1', () => ({
      status: 200,
      headers: { 'set-cookie': 'GTK=mocked_gtk_value; Path=/' },
      body: { code: 200, token: '', message: '', data: {} },
    }));

    mockResponses.set('/login.awp?v=', (req) => {
      if (req.body && req.body.cn === 'mocked_cn' && req.body.cv === 'mocked_cv') {
        return {
          status: 200,
          headers: { 'X-Token': 'final_session_token' },
          body: {
            code: 200,
            token: 'final_session_token',
            message: '',
            data: {
              accounts: [mockRawAccount],
            },
          },
        };
      }
      return {
        status: 200,
        headers: { '2fa-token': 't1', 'x-token': 'x1' },
        body: { code: 250, token: '', message: '2FA required', data: {} },
      };
    });

    mockResponses.set('/connexion/doubleauth.awp?verbe=get', () => ({
      status: 200,
      headers: { '2fa-token': 't2', 'x-token': 'x2' },
      body: {
        code: 200,
        token: '',
        message: '',
        data: {
          question: encodeBase64('What is your favorite color?'),
          propositions: [encodeBase64('Blue'), encodeBase64('Red'), encodeBase64('Green')],
        },
      },
    }));

    mockResponses.set('/connexion/doubleauth.awp?verbe=post', (req) => {
      expect(req.body.choix).toBe(encodeBase64('Red'));
      return {
        status: 200,
        headers: { '2fa-token': 't3', 'x-token': 'x3' },
        body: {
          code: 200,
          token: '',
          message: '',
          data: {
            cn: 'mocked_cn',
            cv: 'mocked_cv',
          },
        },
      };
    });

    const on2faRequired = mock((question, choices) => {
      return 'red';
    });

    const result = await ld.auth.login('testuser', 'testpass', { on2faRequired });

    expect(on2faRequired).toHaveBeenCalled();
    expect(result.type).toBe('success');
    if (result.type === 'success') {
      expect(result.token).toBe('final_session_token');
    }
  });

  it('throws an error on invalid 2FA selection option', async () => {
    mockResponses.set('/login.awp?gtk=1', () => ({
      status: 200,
      headers: { 'set-cookie': 'GTK=mocked_gtk_value; Path=/' },
      body: { code: 200, token: '', message: '', data: {} },
    }));

    mockResponses.set('/login.awp?v=', () => ({
      status: 200,
      headers: { '2fa-token': 't1', 'x-token': 'x1' },
      body: { code: 250, token: '', message: '2FA required', data: {} },
    }));

    mockResponses.set('/connexion/doubleauth.awp?verbe=get', () => ({
      status: 200,
      headers: { '2fa-token': 't2', 'x-token': 'x2' },
      body: {
        code: 200,
        token: '',
        message: '',
        data: {
          question: encodeBase64('What is your favorite color?'),
          propositions: [encodeBase64('Blue'), encodeBase64('Red'), encodeBase64('Green')],
        },
      },
    }));

    const result = (await ld.auth.login('testuser', 'testpass')) as any;
    expect(result.type).toBe('securityQuestion');
    expect(result.answer('Yellow')).rejects.toThrow();
  });

  it('fails login on bad credentials', async () => {
    mockResponses.set('/login.awp?gtk=1', () => ({
      status: 200,
      headers: { 'set-cookie': 'GTK=mocked_gtk_value; Path=/' },
      body: { code: 200, token: '', message: '', data: {} },
    }));

    mockResponses.set('/login.awp?v=', () => ({
      status: 200,
      body: {
        code: 505,
        message: 'Mot de passe invalide',
        data: {},
      },
    }));

    expect(ld.auth.login('testuser', 'badpass')).rejects.toThrow();
  });

  it('supports multiple accounts listing and switching', async () => {
    mockResponses.set('/login.awp?gtk=1', () => ({
      status: 200,
      headers: { 'set-cookie': 'GTK=mocked_gtk_value; Path=/' },
      body: { code: 200, token: '', message: '', data: {} },
    }));

    mockResponses.set('/login.awp?v=', () => ({
      status: 200,
      headers: { 'X-Token': 'mocked_session_token' },
      body: {
        code: 200,
        token: 'mocked_session_token',
        message: '',
        data: {
          accounts: [mockRawAccount, mockRawAccount2],
        },
      },
    }));

    await ld.auth.login('testuser', 'testpass');

    const accounts = ld.auth.getAccounts();
    expect(accounts.length).toBe(2);
    expect(accounts[0].id).toBe(9876);
    expect(accounts[1].id).toBe(5555);

    expect(ld.auth.getAccount()?.id).toBe(9876);

    await ld.auth.switchAccount(5555);
    expect(ld.auth.getAccount()?.id).toBe(5555);
    expect(ld.auth.getAccount()?.prenom).toBe('Jane');

    expect(ld.auth.switchAccount(9999)).rejects.toThrow();
  });

  it('handles logout successfully', async () => {
    mockResponses.set('/login.awp?gtk=1', () => ({
      status: 200,
      headers: { 'set-cookie': 'GTK=mocked_gtk_value; Path=/' },
      body: { code: 200, token: '', message: '', data: {} },
    }));

    mockResponses.set('/login.awp?v=', () => ({
      status: 200,
      headers: { 'X-Token': 'mocked_session_token' },
      body: {
        code: 200,
        token: 'mocked_session_token',
        message: '',
        data: {
          accounts: [mockRawAccount],
        },
      },
    }));

    await ld.auth.login('testuser', 'testpass');
    expect(ld.auth.getAccount()).toBeDefined();

    await ld.auth.logout();
    expect(ld.auth.getAccount()).toBeUndefined();
  });

  it('A4: logout empties the storage completely', async () => {
    const store = new Map<string, string>();
    const { ld: ld2 } = createTestClient({
      storage: {
        get: (k: string) => store.get(k) ?? null,
        set: (k: string, v: string) => void store.set(k, v),
        delete: (k: string) => void store.delete(k),
      },
    });
    try {
      const acc1: any = { id: 9876, identifiant: 'Test.user', main: true };
      const acc2: any = { id: 5555, identifiant: 'Test.user2', main: false };
      ld2.ctx.account = acc1;
      ld2.ctx.accounts = [acc1, acc2];
      for (const [k, v] of [
        ['ed_tk', 't'],
        ['ed_tft', 't2'],
        ['ed_acc', '{}'],
        ['ed_accs', '[]'],
        ['ed_lr', new Date().toISOString()],
        ['ed_offline_queue', '[]'],
        ['ed_access_token_9876', 'at'],
        ['ed_uuid_9876', 'u'],
        ['ed_uuid_Test.user', 'u1'],
        ['ed_access_token_5555', 'at2'],
        ['ed_uuid_5555', 'u2'],
        ['ed_uuid_Test.user2', 'u3'],
      ]) {
        store.set(k, v);
      }
      await ld2.auth.logout();
      expect(store.size).toBe(0);
    } finally {
      ld2.destroy();
    }
  });

  it('A6: network failure during refresh rejects with EdNetworkError, no password prompt', async () => {
    const { EdNetworkError } = await import('../src/core/errors');
    const store = new Map<string, string>([
      ['ed_access_token_9876', 'saved_access_token'],
      ['ed_uuid_9876', 'saved_uuid'],
    ]);
    const onCredentialsRequired = mock(async () => ({ identifiant: 'u', motdepasse: 'p' }));
    const { ld: ld2 } = createTestClient({
      storage: {
        get: (k: string) => store.get(k) ?? null,
        set: (k: string, v: string) => void store.set(k, v),
        delete: (k: string) => void store.delete(k),
      },
      onCredentialsRequired,
    });
    try {
      ld2.ctx.account = { ...mockRawAccount } as any;
      ld2.ctx.token = 'expired_token';

      mockResponses.set('/login.awp?gtk=1', () => ({
        status: 200,
        headers: { 'set-cookie': 'GTK=g; Path=/' },
        body: { code: 200, token: '', message: '', data: {} },
      }));
      mockResponses.set('/notes.awp', () => ({
        status: 200,
        body: { code: 520, message: 'Session expired', data: {} },
      }));
      const origFetch = globalThis.fetch;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (
          input.toString().includes('/login.awp?v=') &&
          init?.body?.toString().includes('isReLogin')
        ) {
          throw new Error('offline');
        }
        return origFetch(input, init);
      }) as typeof fetch;

      const { getGrades } = { getGrades: ld2.grades.getGrades };
      await expect(getGrades()).rejects.toBeInstanceOf(EdNetworkError);
      expect(onCredentialsRequired).not.toHaveBeenCalled();
    } finally {
      ld2.destroy();
    }
  });

  it('A9: queued entries are sent after a successful login', async () => {
    const store = new Map<string, string>();
    const { ld: ld2 } = createTestClient({
      storage: {
        get: (k: string) => store.get(k) ?? null,
        set: (k: string, v: string) => void store.set(k, v),
        delete: (k: string) => void store.delete(k),
      },
      offlineQueue: true,
    });
    mockResponses.set('/login.awp?gtk=1', () => ({
      status: 200,
      headers: { 'set-cookie': 'GTK=mocked_gtk_value; Path=/' },
      body: { code: 200, token: '', message: '', data: {} },
    }));
    mockResponses.set('/login.awp?v=', () => ({
      status: 200,
      headers: { 'X-Token': 'mocked_session_token' },
      body: {
        code: 200,
        token: 'mocked_session_token',
        message: '',
        data: { accounts: [mockRawAccount] },
      },
    }));
    mockResponses.set('/queued-mutation.awp', () => ({
      status: 200,
      body: { code: 200, message: '', data: { success: true } },
    }));

    await ld2.offlineQueue.push('/queued-mutation.awp?verbe=put', {
      method: 'POST',
      body: { x: 1 },
    });
    expect(ld2.offlineQueue.getQueue().length).toBe(1);

    await ld2.auth.login('testuser', 'testpass');
    await new Promise((r) => setTimeout(r, 100));

    expect(requests.some((req) => req.url.includes('/queued-mutation.awp'))).toBe(true);
    expect(ld2.offlineQueue.getQueue().length).toBe(0);
    ld2.destroy();
  });

  it('B5: login without accounts throws NO_ACCOUNT', async () => {
    const { EdAuthError } = await import('../src/core/errors');
    mockResponses.set('/login.awp?gtk=1', () => ({
      status: 200,
      headers: { 'set-cookie': 'GTK=g; Path=/' },
      body: { code: 200, token: '', message: '', data: {} },
    }));
    for (const data of [{}, { accounts: [] }]) {
      mockResponses.set('/login.awp?v=', () => ({
        status: 200,
        headers: { 'X-Token': 't' },
        body: { code: 200, token: 't', message: '', data },
      }));
      try {
        await ld.auth.login('testuser', 'testpass');
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err).toBeInstanceOf(EdAuthError);
        expect(err.code).toBe('NO_ACCOUNT');
      }
    }
  });
});
