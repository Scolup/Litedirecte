// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
// Two independent instances: separate tokens, queues, timers and listeners.
// Logging out of one never affects the other.
// Run with: bun examples/two-accounts.ts
import { Litedirecte, createMemoryStorage } from '../src/index';

const shared = createMemoryStorage();
const alice = new Litedirecte({ storage: shared, storageNamespace: 'alice:' });
const bob = new Litedirecte({ storage: shared, storageNamespace: 'bob:' });
try {
  await alice.auth.login('alice.doe', 'secret');
  await bob.auth.login('bob.doe', 'secret');

  const [aliceGrades, bobGrades] = await Promise.all([
    alice.grades.getGrades(),
    bob.grades.getGrades(),
  ]);
  console.log(
    `Alice: ${aliceGrades.notes?.length ?? 0} grades, Bob: ${bobGrades.notes?.length ?? 0} grades.`,
  );

  await alice.auth.logout();
  console.log('Alice logged out; Bob still logged in:', bob.auth.getAccount() !== undefined);
} finally {
  alice.destroy();
  bob.destroy();
}
