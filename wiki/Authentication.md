<p align="center">
  <picture><source media="(prefers-color-scheme: light)" srcset="https://shieldcn.dev/header/glow.svg?title=Auth+and+sessions&amp;subtitle=Learn+how+to+login+with+Litedirecte.&amp;logo=lu%3AKey&amp;mode=light&amp;theme=blue&amp;align=left" /><img alt="Auth and sessions | Learn how to login with Litedirecte." src="https://shieldcn.dev/header/glow.svg?title=Auth+and+sessions&amp;subtitle=Learn+how+to+login+with+Litedirecte.&amp;logo=lu%3AKey&amp;mode=dark&amp;theme=blue&amp;align=left" /></picture>
</p>

The authentication module is the gateway to Litedirecte. It manages everything related to connecting to EcoleDirecte's servers, handling Two-Factor Authentication (2FA), saving session cookies secretly, and auto-refreshing expired tokens.

---

## 🚀 Getting Started

Create a `Litedirecte` instance, then log in with your username and password. The constructor performs no I/O and never loads a session by itself — restoring a saved session stays explicit via `ld.auth.loadSession()`.

```typescript
import { Litedirecte } from "litedirecte";

const ld = new Litedirecte({ maxRetries: 2 });

const session = await ld.auth.login("your_username", "your_password", {
  rememberMe: true, // Automatically refreshes session securely for easy subsequent reconnects!
});
console.log(`Hello, ${session.user.prenom}!`);
```

Restore a saved session (e.g. after `rememberMe: true`) without prompting for credentials:

```typescript
const restored = await ld.auth.loadSession();
console.log(restored ? "Session restored!" : "No saved session.");
```

---

## 🔒 Handling Two-Factor Authentication (2FA)

EcoleDirecte frequently prompts users with security questions. Litedirecte provides two different ways to tackle this challenge effortlessly!

### 1. The Automatic Callback (Simplest)

Provide an `on2faRequired` handler in your configuration. It will run whenever a 2FA challenge occurs. You can return either the index of the choice or the actual choice text (case-insensitive!).

```typescript
import { Litedirecte } from "litedirecte";

const ld = new Litedirecte();

const session = await ld.auth.login("username", "password", {
  on2faRequired: async (question, choices) => {
    console.log("Security Question:", question);
    console.log("Options:", choices);

    // You can prompt the user, or simply return a selection:
    return 0; // Selects the first choice
    // OR:
    return "The dress is white and gold"; // Selects the choice matching "The dress is white and gold" (case-insensitive)
  }
});
```

### 2. The Step-by-Step Response (Interactive)

If no callback is provided, `ld.auth.login()` returns a special `LoginChallenge` object. You can present this to your user and call its `.answer()` method when they're ready!

```typescript
import { Litedirecte } from "litedirecte";

const ld = new Litedirecte();

const result = await ld.auth.login("username", "password");

if (result.type === "securityQuestion") {
  console.log("2FA incoming!");
  console.log("Question:", result.question);
  console.log("Options:", result.choices);

  // Submit the selected choice index or option text:
  const session = await result.answer("My Secret Answer");
  console.log(`Logged in! Hello, ${session.user.prenom}`);
} else if (result.type === "success") {
  console.log(`Logged in... without 2FA?! Hello, ${result.user.prenom}`);
}
```

---

## 📖 API Reference

### `ld.auth.login`

Authenticates a student and registers the session on the instance. There is exactly one signature — `login(username, password, options?)` — and no aliases: pass the raw username and password strings.

```typescript
ld.auth.login(
  username: string,
  password: string,
  options?: LoginOptions
): Promise<LoginResult>
```

#### Options

- `rememberMe` *(boolean)*: If set to `true`, Litedirecte stores the encrypted refresh tokens, UUID, and session identifiers (no password stored!) locally. This allows you to restore the session later via `ld.auth.loadSession()` without prompting the user for credentials. Also accepts `storage` and `passkey` to select the adapter for this login.
- `on2faRequired` *(function)*: A callback triggered if a 2FA challenge is present.
- `ignore` *(Resource[])*: Resources skipped by the background `getAll` prefetch that runs after a successful interactive login (defaults to `fetchIgnore`). See [Cache & sync](Cache.md).

After a successful interactive login (including 2FA completion), a background `getAll` prefetch runs: `login` returns without waiting for it and never fails because of it. A failure is reported through the sync status. The refresh-internal login and session restore never prefetch.

---

### `ld.auth.logout`

Disconnects the active account, stops background keepalives, and completely wipes the session details from memory and storage. Other instances are unaffected. The instance's cache is purged for every account, the sync state returns to `signed-out`, and in-flight requests are abandoned (see below). Polling itself is not stopped: ticks simply do nothing until a session exists again.

```typescript
ld.auth.logout(): Promise<void>
```

---

### `ld.auth.refreshToken`

Renews the current session token behind the scenes. If you used `rememberMe: true` during your previous login, you can call this at startup to refresh your connection.

> [!TIP]
> This should be done automatically without your intervention if a request fails because of an invalid token.

```typescript
ld.auth.refreshToken(): Promise<string>
```

Everything under `ld.auth` is per instance: `loadSession`, `clearSession`, `getAccount`, `getAccounts`, `switchAccount`, `getLastTokenRefresh`, `checkTokenHealth`, `startTokenKeepalive` and `stopTokenKeepalive` all read and write only their own instance. Two instances never share tokens, accounts, queues or timers.

---

## 🛰️ Foreground vs background requests

Poll ticks, the login / account-switch prefetch, timetable neighbour prefetches and background revalidations of stale data are **background requests**. Reads and mutations the app asked for are **foreground requests**. This distinction is internal; there is no public option for it.

- Refresh is **silent first**: it tries the stored access token. Only a *foreground* request may then fall back to `onCredentialsRequired` / `on2faRequired`. Background requests never call them: if the silent refresh fails with an auth error they fail with `EdAuthError`.
- `onCredentialsRequired` and `on2faRequired` are therefore called only for foreground requests. When the token expires while polling runs, the tick triggers exactly one silent refresh; if it fails with an auth error, the poller reports it once, sets the sync state to `auth-required` and **pauses ticks** — no credentials prompt appears. A foreground read during the pause may perform the interactive refresh (that is when the user is prompted); success lifts the pause and ticks resume. Apps should watch `ld.sync` for `auth-required` instead of waiting for a prompt.
- A successful token refresh is **not** a session change: it never purges the cache or changes the session generation.

---

## 🧬 Session generation

Every session change (`logout`, `clearSession`, `switchAccount`, a login as another account, `destroy`) increments the instance's session generation. A request remembers the generation it started under. When a response, error or late `520` arrives under an **older** generation, the request is **abandoned**: nothing is cached, no event or sync update is produced, and no refresh or credentials prompt is started. If the app is waiting on it, it rejects with `EdAuthError` code `SESSION_ENDED`.

Concretely: `logout()` during an in-flight tick abandons all of that `getAll`'s requests — no cache writes, no `new*` events, no `pollingError`, no refresh, no prompt; the tick settles quietly and the state ends as `signed-out`. `switchAccount()` during polling abandons the previous account's tick and prefetches the new account. After a login as another account, in-flight reads fail with `EdAuthError` instead of retrying against the old account's URLs. Ticks while offline do nothing and the state is `offline`; coming back online flushes the offline queue and runs a catch-up tick when due.

---

## 🗂️ Type Definitions

### `LoginResult`

The return value of `ld.auth.login()` is a union:

```typescript
type LoginResult = LoginSuccess | LoginChallenge;
```

### `LoginSuccess`

Returned when the user is successfully logged in.

```typescript
interface LoginSuccess {
  type: "success";     // Discriminator type
  user: Account;       // The active student account details
  token: string;       // Current API session token
  sessionId: string;   // Unique session ID
}
```

### `LoginChallenge`

Returned if EcoleDirecte requires a 2FA question response.

```typescript
interface LoginChallenge {
  type: "securityQuestion";
  question: string;
  choices: string[];
  answer: (choiceIndexOrText: number | string) => Promise<LoginSuccess>;
}
```

### `Account`

Contains the student's profile, classes, and active modules:

```typescript
interface Account {
  idLogin: number;
  id: number;
  uid: string;
  identifiant: string;
  typeCompte: "E" | "P" | "A" | "F"; // "E" for student
  prenom: string;
  nom: string;
  email: string;
  nomEtablissement: string;
  main: boolean;
  accessToken?: string;
  profile: {
    sexe: "M" | "F";
    photo: string;
    classe?: {
      id: number;
      code: string;
      libelle: string;
    };
  };
  modules: Array<{
    code: string;
    enable: boolean;
    badge: number;
    params: Record<string, any>;
  }>;
}
```
