// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import { Litedirecte, createMemoryStorage } from '../src/index';
import type { Account, EdConfig, StorageAdapter } from '../src/index';

export function testAccount(overrides: Partial<Account> = {}): Account {
  return {
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
    profile: { sexe: 'M', photo: 'https://example.com/photo.jpg' },
    modules: [
      { code: 'NOTES', enable: true, badge: 0, params: {} },
      { code: 'EDT', enable: true, badge: 0, params: {} },
      { code: 'CAHIER_DE_TEXTES', enable: true, badge: 0, params: {} },
      { code: 'VIE_SCOLAIRE', enable: true, badge: 0, params: {} },
    ],
    ...overrides,
  };
}

export function createTestClient(config: EdConfig = {}): {
  ld: Litedirecte;
  storage: StorageAdapter;
} {
  const storage = config.storage ?? createMemoryStorage();
  const ld = new Litedirecte({
    maxRetries: 0,
    retryDelay: 1,
    timeout: 1000,
    offlineQueue: false,
    ...config,
    storage,
  });
  return { ld, storage };
}

/** Persist a session to storage, then load it into the instance. */
export async function seedSession(
  storage: StorageAdapter,
  ld: Litedirecte,
  account: Account = testAccount(),
  token = 'valid_token',
): Promise<void> {
  await storage.set('ed_tk', token);
  await storage.set('ed_acc', JSON.stringify(account));
  await storage.set('ed_accs', JSON.stringify([account]));
  const loaded = await ld.auth.loadSession();
  if (!loaded) throw new Error('seedSession failed to load');
}
