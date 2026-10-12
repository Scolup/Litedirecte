// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
// Basic usage: log in (with a 2FA callback), read grades, clean up.
// Run with: bun examples/basic.ts
import { Litedirecte, nodeStorage } from '../src/index';

const ld = new Litedirecte({ storage: nodeStorage(), maxRetries: 2 });
try {
  const result = await ld.auth.login('john.doe', 'secret', {
    rememberMe: true,
    on2faRequired: async (question, choices) => {
      console.log('Security question:', question);
      console.log('Choices:', choices);
      return 0;
    },
  });

  if (result.type === 'securityQuestion') {
    console.log('Answer the challenge, then rerun.');
  } else {
    console.log(`Logged in as ${result.user.prenom} ${result.user.nom}`);
    const grades = await ld.grades.getGrades();
    console.log(`Loaded ${grades.notes?.length ?? 0} grades.`);
  }
} finally {
  ld.destroy();
}
