<p align="center">
    <picture><source media="(prefers-color-scheme: light)" srcset="https://shieldcn.dev/header/glow.svg?title=Litedirecte&subtitle=Your+first-rate+SDK+for+working+with+EcoleDirecte+data.&logo=data%3Aimage%2Fsvg%2Bxml%2C%3Csvg+xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27+fill%3D%27none%27+viewBox%3D%270+0+24+25%27%3E%3Cpath+fill%3D%27%2523000%27+d%3D%27M21+11.5c-.3-3.2-4.5-5.6-9.4-5.2s-8.8+4-8.6+7.3c0+0+1.8-5.6+8-6.1+4-.3+7.4+1.5+7.6+4.2.2+2.1-2+4.1-5+5q-.6+0-.4-.3+0-.3-.2-.3l-1.8.1H9.7l-.3-.3.3-1.8.2-1.3.3-1.6c1-2.3-1.5-2.2-1.6-1.6v.8L8+13c-.4+2.1-.8+4.4-.6+4.5q2.5.9+5+.6c5-.4+8.9-3.3+8.6-6.6%27%2F%3E%3C%2Fsvg%3E&mode=light&theme=blue&align=left" /><img alt="Litedirecte, your first-rate SDK for working with EcoleDirecte data." src="https://shieldcn.dev/header/glow.svg?title=Litedirecte&subtitle=Your+first-rate+SDK+for+working+with+EcoleDirecte+data.&logo=data%3Aimage%2Fsvg%2Bxml%2C%3Csvg+xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27+fill%3D%27none%27+viewBox%3D%270+0+24+25%27%3E%3Cpath+fill%3D%27%2523000%27+d%3D%27M21+11.5c-.3-3.2-4.5-5.6-9.4-5.2s-8.8+4-8.6+7.3c0+0+1.8-5.6+8-6.1+4-.3+7.4+1.5+7.6+4.2.2+2.1-2+4.1-5+5q-.6+0-.4-.3+0-.3-.2-.3l-1.8.1H9.7l-.3-.3.3-1.8.2-1.3.3-1.6c1-2.3-1.5-2.2-1.6-1.6v.8L8+13c-.4+2.1-.8+4.4-.6+4.5q2.5.9+5+.6c5-.4+8.9-3.3+8.6-6.6%27%2F%3E%3C%2Fsvg%3E&mode=dark&theme=blue&align=left" /></picture>
</p>

<p align="center">
  <picture><source media="(prefers-color-scheme: light)" srcset="https://shieldcn.dev/group/npm/litedirecte+github/Scolup/Litedirecte/stars+github/Scolup/Litedirecte/license+badge/Actively-maintained-22c55e.svg?variant=secondary&amp;theme=blue&amp;mode=light" /><img alt="badge group" src="https://shieldcn.dev/group/npm/litedirecte+github/Scolup/Litedirecte/stars+github/Scolup/Litedirecte/license+badge/Actively-maintained-22c55e.svg?variant=secondary&amp;theme=blue" /></picture>
</p>

**Litedirecte** is a fast, easy-to-use, complete and fully tree-shakable TypeScript/JavaScript SDK for interacting with the private **EcoleDirecte API**.

Whether you are building Discord bots, native mobile apps, web apps, or others, Litedirecte handles all the messy stuff so you can focus on building what matters.

---

## ⭐️ Key Features

- 🌳 **Tree-shakeable** | Import only what you use.
- 🚪 **Fully auto auth** | GTK cookies, tokens, 2FA, and token refreshes are fully managed silently.
- 🛣️ **Built-in proxy support** | Perfect for running directly in browsers (bypassing CORS).
- 🛜 **Offline** | Built-in offline action queues and auto-caching.
- ⚡ **Instant reads** | Every read goes through an always-on cache (`getAll`, built-in polling, `watch`, one sync status). Results are shared: treat them as read-only.
- 🎓 **Rich feature set** | Fully supports grades, timetable, homework, messages, attendance, cloud, QCM and more. _Parent account support coming this year!_
- 🌐 **Available everywhere** | Works flawlessly on Node.js 18+, Bun, Deno, modern browsers*, Cloudflare Workers, React Native, Capacitor, Electron, etc.
- 🔒 **Secure** | Zero password stored; supports AES-GCM data encryption.

---

## 🚀 Quick Start

Get Litedirecte up and running in under a minute!

### 1. Install the SDK

Using **npm**:
```bash
npm install litedirecte
```

Using **Bun**:
```bash
bun add litedirecte
```

### 2. Log In Easily

Let Litedirecte log you in, handle token storage, and coordinate security questions:

```typescript
import { Litedirecte } from "litedirecte";

const ld = new Litedirecte({ maxRetries: 2 });

const result = await ld.auth.login("your_username", "your_password", {
  rememberMe: true, // Auto-saves session for seamless subsequent loads
  on2faRequired: async (question, choices) => {
    console.log("EcoleDirecte Security Question:", question);
    console.log("Choices:", choices);

    // Choose your answer: return either the choice index (number) or text (string)
    return 0; // Selects the first choice
  }
});

if (result.type === "success") {
  console.log(`Success! Logged in as ${result.user.prenom} ${result.user.nom}`);
}
```

### 3. Fetch Student Data

Once authenticated, call any of Litedirecte's modular methods. You never need to handle authorization tokens manually again:

```typescript
import { Litedirecte } from "litedirecte";

const ld = new Litedirecte();
await ld.auth.login("your_username", "your_password");

const gradesResult = await ld.grades.getGrades();

console.log(`Loaded ${gradesResult.notes.length} grades!`);
if (gradesResult.notes.length > 0) {
  console.log(`Latest grade: ${gradesResult.notes[0].valeur}/${gradesResult.notes[0].noteSur}`);
}

// Each instance is independent: two clients never share tokens, queues or timers.
const other = new Litedirecte({ storageNamespace: "other:" });
await other.auth.loadSession();

// Always clean up timers and listeners when done:
ld.destroy();
other.destroy();
```

---

## 📖 Documentation

For full instructions, configuration guides, and references, explore the **[project wiki](https://github.com/Scolup/Litedirecte/wiki)**.

---

## ⚖️ License & Legal

Litedirecte is licensed under the **Affero General Public License v3** (AGPL 3.0).

This means if you utilize Litedirecte inside a project and make it publicly available (such as an executable download, mobile application, or web/server service), you **must** make your project open-source under that same license.

> [!TIP]
> For projects already under GPL 3.0, **you don't have to change your license!** GPL and AGPL are fully compatible. You are only required to use AGPL if you host Litedirecte on a server.

*This project is an independent third-party development and is **not affiliated or sponsored** in any way with Aplim or EcoleDirecte.*

> [!CAUTION]
> **LITEDIRECTE MIGHT HANDLE MINORS' DATA. ALWAYS ASK FOR PARENT CONSENT BEFORE STORING ANYWHERE OR PROCESSING DATA THROUGH SERVERS.**

---

<p align="center">
  Made with ❤️ by typeof (Scolup)

  *Chromium only works when the proxy is enabled.
</p>
