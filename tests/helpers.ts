// © 2026 typeof (Scolup) | Licensed under AGPL 3.
import type { Account } from '../src/types';

export const mockAccount: Account = {
  loginId: 1234567,
  id: 9876,
  uid: 'session_uid',
  identifiant: 'Test.user',
  accountType: 'E',
  firstName: 'John',
  lastName: 'Doe',
  email: 'john.doe@example.com',
  schoolName: 'Ecole Test',
  main: true,
  profile: {
    gender: 'M',
    photoUrl: 'https://example.com/photo.jpg',
  },
  modules: [{ code: 'NOTES', enable: true, badge: 0, params: {} }],
};

export const mockRawAccount = {
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
    photoUrl: 'https://example.com/photo.jpg',
  },
  modules: [{ code: 'NOTES', enable: 1, badge: 0, params: {} }],
};

export const mockRawAccount2 = {
  ...mockRawAccount,
  id: 5555,
  uid: 'session_uid2',
  identifiant: 'Test.user2',
  prenom: 'Jane',
  email: 'jane.doe@example.com',
  main: false,
  accesstoken: 'mocked_access_token2',
  photo: 'https://example.com/photo2.jpg',
  profile: {
    sexe: 'F',
    photoUrl: 'https://example.com/photo2.jpg',
  },
};

export function encodeBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function parseBody(init?: RequestInit): any {
  if (!init?.body) return undefined;
  const bodyStr = init.body.toString();
  if (bodyStr.startsWith('data=')) {
    const jsonStr = decodeURIComponent(bodyStr.substring(5));
    try {
      return JSON.parse(jsonStr);
    } catch {
      return bodyStr;
    }
  }
  return bodyStr;
}

export function parseHeaders(init?: RequestInit): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!init?.headers) return headers;
  if (init.headers instanceof Headers) {
    init.headers.forEach((value, key) => {
      headers[key] = value;
    });
  } else {
    Object.assign(headers, init.headers);
  }
  return headers;
}
// © 2026 typeof (Scolup) | Licensed under AGPL 3.
