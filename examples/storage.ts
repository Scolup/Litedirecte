// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
// Encrypted session storage: everything persisted is AES-GCM encrypted
// with your passkey before touching the adapter.
// Run with: bun examples/storage.ts
import { Litedirecte, nodeStorage } from '../src/index';

const ld = new Litedirecte({
  storage: nodeStorage('./litedirecte-session.json'),
  passkey: 'correct horse battery staple',
});
try {
  const restored = await ld.auth.loadSession();
  if (!restored) {
    await ld.auth.login('john.doe', 'secret', { rememberMe: true });
  }
  console.log('Logged in as:', ld.auth.getAccount()?.identifiant);
} finally {
  ld.destroy();
}
