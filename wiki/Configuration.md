<p align="center">
  <picture><source media="(prefers-color-scheme: light)" srcset="https://shieldcn.dev/header/glow.svg?title=Configuration&amp;subtitle=Learn+how+to+configure+Litedirecte.&amp;logo=lu%3ASettings2&amp;mode=light&amp;theme=blue&amp;align=left" /><img alt="Configuration | Learn how to configure Litedirecte." src="https://shieldcn.dev/header/glow.svg?title=Configuration&amp;subtitle=Learn+how+to+configure+Litedirecte.&amp;logo=lu%3ASettings2&amp;mode=dark&amp;theme=blue&amp;align=left" /></picture>
</p>

You can configure per-instance SDK behaviors (such as request timeouts, retry behavior, and offline queues) through the constructor or `ld.configure()`. Every `Litedirecte` instance owns its config: changing one never affects another.

### `new Litedirecte(config?)` / `ld.configure(partial)`

```typescript
import { Litedirecte } from "litedirecte";

const ld = new Litedirecte({
  maxRetries: 5,
  retryDelay: 1000,
  timeout: 10000, // 10 seconds timeout
  offlineQueue: true, // Queue actions if offline!
});

// …or update part of the config later (validated exactly like the constructor):
ld.configure({ maxRetries: 2 });
```

### All Configuration Options (`EdConfig`)

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `userAgent` | `string` | *(Modern iOS mobile user agent)* | Custom User-Agent header for API requests. |
| `proxyUrl` | `string` | `undefined` | Base URL of a proxy server to relay all API requests through (e.g. to bypass CORS in browsers). Must be a valid absolute `http(s)` URL; a trailing slash is stripped. See [Proxy](#-proxy) below. |
| `maxRetries` | `number` | `3` | Number of times to automatically retry failed requests (e.g. on HTTP 500 or timeout). Integer `>= 0`. |
| `retryDelay` | `number` | `500` | Initial delay between retries in milliseconds (uses exponential backoff with ±20% jitter, capped at 8 s; HTTP 429 honors `Retry-After`, capped at 30 s). Finite `>= 0`. |
| `concurrency` | `number` | `3` | Maximum number of concurrent network requests allowed at once. Integer `>= 1`. |
| `timeout` | `number` | `15000` | Request timeout in milliseconds. Finite `> 0`. Applies to data requests as well as login, 2FA and token refresh. |
| `storage` | `StorageAdapter` | *auto-detected* | Session and data storage adapter (a fresh in-memory adapter per instance when nothing is detected). |
| `storageNamespace` | `string` | `''` | Prefix applied to every persisted key, so several instances can share one adapter without overwriting each other. Must be a string without whitespace. |
| `maxRequestsPerMinute` | `number` | `100` | Sliding-window rate budget (see [Rate limit](#-rate-limit)). Integer `>= 0`; `0` disables it. |
| `passkey` | `string` | `undefined` | Key used to transparently encrypt everything saved in your storage adapter using AES-GCM. |
| `offlineQueue` | `boolean` | `false` | Enable or disable the offline mutation queue. |
| `fetchInterval` | `number` | `60` | Built-in polling interval in **seconds**. `0` disables the timer; otherwise a finite number `>= 5`. See [Cache & sync](Cache.md). |
| `fetchIgnore` | `Resource[]` | `[]` | Resources skipped by the login/switch prefetch and by every poll tick. Same values and validation as `getAll({ ignore })`. Ignored resources become manual cache entries. |
| `isOnline` | `() => boolean` | `navigator.onLine` where available, else online | Online probe. Never throws. When offline, reads serve the newest cached copy (even a dead one) and report `offline` through `ld.sync`; a read with nothing cached rejects with `EdOfflineError`. |
| `on2faRequired` | `Function` | `undefined` | Instance callback to handle 2FA challenges. |
| `onCredentialsRequired` | `Function` | `undefined` | Callback to supply credentials on token refresh failure. Only called for authentication failures — never when the refresh fails because the network is down. |
| `onError` | `(error: EdError) => void` | `undefined` | Plain observer called with reported errors. It takes a single argument and never influences retrying. |

Invalid values throw `EdValidationError` and leave the previous configuration untouched.

### Always-on cache and built-in polling

Every `verbe=get` read goes through the per-instance cache (`CACHE_TTL_MS = 60_000`, no opt-in) and every read accepts `{ force: true }` to skip the cache, fetch, and write through. Results are shared memoized objects: treat them as **read-only**. Constructing the instance arms the built-in `getAll` poller; `ld.stopPolling()` / `ld.resumePolling()` control it, and `ld.getAll({ ignore })` fetches every resource at once. See [Cache & sync](Cache.md) for the fresh/stale/dead model, `watch`, `ld.sync`, offline behaviour and privacy.

### Retry rules

Reads are retried on network errors, timeouts, parse errors and 5xx responses. Mutations (any request with `queued: true`, or any endpoint whose `verbe` is not `get`) are **not** retried on those failures — replaying a non-idempotent request could duplicate it server-side. Mutations are only retried after an HTTP `429` (the request was not processed) and through the expired-session refresh path.

### Timers

The SDK never keeps your process alive: polling intervals, the token keepalive, the rate-limit timer and request-timeout fallbacks are all `unref`'d where the runtime supports it, and fallback timeout handles are cleared as soon as their request settles. A script that only polls exits by itself. `ld.destroy()` stops every timer, removes every global listener the instance registered, and rejects queued rate-limited requests; using the instance afterwards throws `EdValidationError('Instance destroyed')`.

---

## 🧩 Module support

Namespaces that map to an EcoleDirecte module check the **current** account before any network request. If the account lacks the module, an `EdUnsupportedModuleError` is thrown (and never retried):

| Namespace | Module code | Verified how |
| :--- | :--- | :--- |
| `ld.grades` | `NOTES` | BlocksDirecte `MarkModules` + this repo's mock account |
| `ld.timetable` | `EDT` | BlocksDirecte `TimetableModules` |
| `ld.homework` | `CAHIER_DE_TEXTES` | BlocksDirecte `HomeworkModules` |
| `ld.attendance` | `VIE_SCOLAIRE` | BlocksDirecte `SchoolLifeModules` (`/viescolaire.awp`) |

"Has the module" means the code is present in `account.modules` **and** `enable` is truthy. The check fails open (missing or empty `modules` never blocks) and is skipped in `mockMode`. Messages, timeline, cloud, documents, QCMs and settings have no verified module code and are unchecked. The friendly names live in the exported `ED_MODULES` const:

```typescript
import { Litedirecte } from "litedirecte";

const ld = new Litedirecte();
await ld.auth.login("your_username", "your_password");

if (ld.supports("grades")) {
  await ld.grades.getGrades();
}
console.log(ld.capabilities()); // { grades: true, timetable: false, … }
```

---

## 🚦 Rate limit

EcoleDirecte's real limit is unknown, so each instance budgets at most `maxRequestsPerMinute` (default `100`, a conservative guess) request *starts* per rolling 60 seconds (sliding window). Excess requests **wait** in FIFO order and start as soon as a slot frees up — they are never rejected or dropped. The limiter composes with `concurrency`, and every real network request counts, including retries. Login, 2FA and token-refresh requests count but never wait, so a queued backlog cannot block the refresh that would unblock it. `0` disables the limit. The limiter uses a single `unref`'d `setTimeout` and leaves nothing scheduled once the queue drains.

---

## 🎭 Mock Mode

Mock Mode lets you develop and test your app **without a real EcoleDirecte account or network access**. When `mockMode: true` is passed to any data function, `edFetch` bypasses the network entirely and returns **raw, API-shaped mock data** (same keys as the real EcoleDirecte responses — including messy date strings and Base64-encoded fields). The mock payload is then passed through the exact same `transform` pipeline as real data, so dates become `Date` objects and Base64 fields are decoded, exactly like production.

This is perfect for unit tests, CI, offline demos, or building your UI before credentials are available.

```typescript
import { Litedirecte } from "litedirecte";

const ld = new Litedirecte();

// Every data method accepts a `mockMode` option
const grades = await ld.grades.getGrades({ mockMode: true });
const inbox = await ld.messages.getMessages({ mockMode: true });
const attendance = await ld.attendance.getAttendance({ mockMode: true });

// Mutations work too — they return plausible raw envelopes
await ld.homework.markAsDone([11243], { mockMode: true });
await ld.messages.sendMessage(
  { subject: "Hi", content: "Hello", destinataires: [{ id: 1, type: "P" }] },
  { mockMode: true },
);
```

#### How it works

- `mockMode` replaces **only** the network layer. Authentication (`ld.auth.login`), token refresh, and the session store are untouched — you still need a logged-in account (e.g. via a test fixture) because methods like `ld.grades.getGrades` call `requireCurrentAccount()`.
- Mock responses use the standard `{ code: 200, token, message, data }` envelope, so all existing validation and `transform` logic runs unchanged. Module checks are skipped in `mockMode`.
- File downloads (`ld.downloads.download`, `ld.downloads.downloadPhoto`) return a small mock `Response` when `mockMode` is set.

#### Supported per-method `mockMode`

`ld.grades.getGrades` (+ `correlate`), `ld.messages` (`getMessages`, `getMessage`, `getContacts`, `sendMessage`, `markAsRead`, `markAsUnread`), `ld.attendance.getAttendance`, `ld.homework` (`getHomework`, `getHomeworkForDate`, `markAsDone`, `markAsUndone`, `sendHomeworkComment`), `ld.timetable` (`getTimetable`, `getTimetableIcalUrl`), `ld.cloud` (`getCloud`, `createFolder`, `deleteNodes`), `ld.documents.getDocuments`, `ld.qcms` (`getQcms`, `getQcmDetail`, `updateQcmStatus`, `submitQcmAnswer`), `ld.settings` (`getSettings`, `updateSettings`, `updateAccessibility`), `ld.timeline` (`getTimeline`, `getCommonTimeline`), `ld.downloads` (`download`, `downloadPhoto`).

---

## 🛣️ Proxy

Litedirecte has built-in proxy support. When `proxyUrl` is set, all API requests and file downloads are routed through that URL instead of hitting EcoleDirecte directly. This is essential when running in browsers, where CORS blocks direct calls to the EcoleDirecte API.

The recommended proxy is [**Procsy**](https://github.com/Scolup/Procsy), a lightweight Cloudflare Workers proxy purpose-built for this use case. It handles CORS headers, IP spoofing, and SSRF protection out of the box.

### Setup

1. **Deploy Procsy** — follow the [Procsy README](https://github.com/Scolup/Procsy#deployment) to deploy it on Cloudflare Workers.

2. **Point Litedirecte at your Procsy instance:**

```typescript
import { Litedirecte } from "litedirecte";

const ld = new Litedirecte({
  proxyUrl: "https://myprocsyinstance.hithisismyname.workers.dev",
});
```

That's it. Every outgoing request will now be relayed through Procsy.

### How it works under the hood

When `proxyUrl` is configured, Litedirecte rewrites all outgoing request URLs to point at the proxy base. It also:

- Moves the user agent from the `User-Agent` header to `X-Procsy-User-Agent`, which bypasses Chromium's 40450316 issue.
- Attaches an `X-Procsy-Base-URL` header containing the original EcoleDirecte API base URL, so the proxy knows where to forward the request.

> **Note**: When `proxyUrl` is **not** set (the default), Litedirecte talks directly to `https://api.ecoledirecte.com/v3`. This works fine in server-side environments where CORS is not a concern.

---

## 🗄️ Storage Adapters (Auto-Detected!)

By default, each instance automatically detects and selects the best storage option for your environment (a fresh in-memory adapter when nothing is detected):

1. **IndexedDB** — used in IndexedDB-capable runtimes (browsers, CF Workers, Deno).
2. **localStorage** — used in standard Web Storage runtimes (browsers if IndexedDB unavailable, React Native).
3. **Node Storage** — used in Node.js or Bun environments.
4. **Memory Storage** — falls back to volatile in-memory storage if nothing else is available.

You can explicitly force an adapter or supply a custom one.

### `indexedDBStorage`
Backed by IndexedDB under a database named `litedirecte`. Perfect for standard web browsers.
```typescript
import { Litedirecte, indexedDBStorage } from "litedirecte";

const ld = new Litedirecte({ storage: indexedDBStorage });
```

### `localStorageStorage`
Backed by the browser's `localStorage` API. Excellent for simple React Native, Capacitor, or Chrome extension usage.
```typescript
import { Litedirecte, localStorageStorage } from "litedirecte";

const ld = new Litedirecte({ storage: localStorageStorage });
```

### `nodeStorage`
Saves your session to a local JSON file. Excellent for command-line tools or servers running in Node.js or Bun.
```typescript
import { Litedirecte, nodeStorage } from "litedirecte";

const ld = new Litedirecte({
  // Saves to './litedirecte-session.json' by default
  storage: nodeStorage(),

  // Or specify a custom path:
  // storage: nodeStorage("/var/data/session.json"),
});
```

Writes are serialized per file, atomic (temporary file + rename), and created with mode `0600`. A truncated/corrupt file is moved aside to `<file>.corrupt` instead of silently wiping your session.

### `createMemoryStorage`
Isolated in-memory storage. Each instance creates its own default adapter when none is configured, so instances never share state unless you pass one adapter explicitly.
```typescript
import { Litedirecte, createMemoryStorage } from "litedirecte";

const ld = new Litedirecte({ storage: createMemoryStorage() });
```

Two instances can share one adapter safely by giving each a `storageNamespace`:
```typescript
const shared = createMemoryStorage();
const alice = new Litedirecte({ storage: shared, storageNamespace: "alice:" });
const bob = new Litedirecte({ storage: shared, storageNamespace: "bob:" });
```

### `cloudflareKVStorage`
Wraps a Cloudflare KV namespace.
```typescript
import { Litedirecte, cloudflareKVStorage } from "litedirecte";

export default {
  async fetch(request, env) {
    const ld = new Litedirecte({ storage: cloudflareKVStorage(env.MY_SESSION_KV) });
    // ...
  }
};
```

### `asyncStorage` (Custom Wrappers)
Allows you to wrap any asynchronous key-value storage engine. Here's how to wrap React Native's `@react-native-async-storage/async-storage`:
```typescript
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Litedirecte, asyncStorage } from "litedirecte";

const ld = new Litedirecte({
  storage: asyncStorage({
    getItem: (key) => AsyncStorage.getItem(key),
    setItem: (key, value) => AsyncStorage.setItem(key, value),
    removeItem: (key) => AsyncStorage.removeItem(key),
  }),
});
```

---

## 🔒 Transparent AES-GCM Encryption

Concerned about storing credentials on disk or in the browser? Simply provide a `passkey`!

When a `passkey` is specified, Litedirecte will **automatically wrap** your active storage adapter with an encrypted wrapper. All session tokens, IDs, and account info will be encrypted using **AES-GCM** before writing, and decrypted on read.

A random 16-byte salt is stored once under the `__ld_salt` key and the AES-GCM key is derived a single time per adapter (a fresh random 12-byte IV is used per write). A value that fails to decrypt (e.g. wrong passkey) reads back as `null` and is reported once per key through `onError` with an `EdError` coded `STORAGE_DECRYPT_FAILED`. See [`encryptedStorage`](#encryptedstorage) below to use the wrapper directly.

```typescript
import { Litedirecte, nodeStorage } from "litedirecte";

const ld = new Litedirecte({
  storage: nodeStorage(),
  passkey: "super-secret-password" // Encryption enabled!
});
```

### `encryptedStorage`

The wrapper that `passkey` installs is also exported, so you can encrypt a value yourself (a token you cache separately, a settings blob) with the exact same scheme:

```typescript
import { Litedirecte, encryptedStorage, localStorageStorage, type EdError } from "litedirecte";

const vault = encryptedStorage(localStorageStorage, "super-secret-password", () => (error) => {
  console.warn("decrypt failed", (error as EdError).code); // STORAGE_DECRYPT_FAILED
});

await vault.set("my_token", "s3cret");

const ld = new Litedirecte({ storage: vault });
```

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `backend` | `StorageAdapter` | The adapter to wrap. |
| `secret` | `string` | Passphrase the AES-GCM key is derived from (PBKDF2). |
| `onError` | `() => ErrorMiddleware \| undefined` | Lazy resolver for the error reporter, so importing an error class cannot create a cycle. |

The `__ld_salt` key and the derived key are computed **once per wrapper**, not once per write, so wrapping a hot adapter costs nothing extra at call time. Reads never reject: a value that fails to decrypt resolves `null` and is reported once per key.

**Scheme:** PBKDF2-SHA256, 100 000 iterations over the 16-byte random salt stored at `__ld_salt`, producing a 256-bit AES-GCM key. Each write draws a fresh random 12-byte IV and stores it as the ciphertext prefix.

---

## 📥 File Downloads

### `ld.downloads.download`

Retrieves documents and other resources from EcoleDirecte.

```typescript
ld.downloads.download(options?: DownloadOptions): Promise<ArrayBuffer | Blob | ReadableStream>
```

#### Options (`DownloadOptions`)
- `as` *("buffer" | "blob" | "stream")*: The format to return. Defaults to `"buffer"`.
- `params` *(Record<string, any>)*: Extra post body parameters.
- `mockMode` *(boolean)*: Return a small mock `Response` instead of requesting.

#### Example (Writing a downloaded PDF to disk in Node/Bun):
```typescript
import { Litedirecte } from "litedirecte";
import { writeFile } from "node:fs/promises";

const ld = new Litedirecte();
await ld.auth.login("your_username", "your_password");

const fileArrayBuffer = await ld.downloads.download({
  params: {
    forceDownload: 0,
    id: 12345,
    type: "bulletin",
  },
});

await writeFile("./report-card.pdf", Buffer.from(fileArrayBuffer));
console.log("PDF written to disk!");
```

### `ld.downloads.downloadPhoto`

Retrieves the profile picture of the currently active account.

```typescript
ld.downloads.downloadPhoto(options?: { as?: "buffer" | "blob" | "stream" }): Promise<ArrayBuffer | Blob | ReadableStream | null>
```

---

## 🛟 Offline Mutation Queue

When no internet is available, you don't want actions like marking homework as completed to be lost. By enabling `offlineQueue: true` in your configuration, supported mutating requests will be recorded locally if the user is offline. The following methods are queued: `ld.homework.markAsDone`, `ld.homework.markAsUndone`, `ld.homework.sendHomeworkComment`, `ld.cloud.createFolder`, `ld.cloud.deleteNodes`, and `ld.messages.sendMessage`. (`ld.settings.updateSettings` is deliberately **not** queued: a password change must never be replayed later from storage.)

Queued entries are flushed automatically (fire and forget) after a successful `login` or `loadSession`, and when the runtime fires an `online` event. Each entry carries an attempt counter and a creation timestamp: entries the server permanently rejects (API error), entries that failed 5 times, and entries older than 7 days are dropped; entries that failed only because of a network error are kept. Each instance owns its queue: entries queued on one instance are never visible to another.

You can synchronize them once the connection is restored:

```typescript
import { Litedirecte } from "litedirecte";

const ld = new Litedirecte({ offlineQueue: true });

// Check the queue
const pendingCount = ld.offlineQueue.getQueue().length;
console.log(`You have ${pendingCount} offline actions pending.`);

// Flush the queue to send them to EcoleDirecte
await ld.offlineQueue.flush();
```

---

## 🗂️ Type Definitions

### `EdConfig`

Defines per-instance parameters passed to `new Litedirecte(config)` or `ld.configure(partial)`.

```typescript
interface EdConfig {
  userAgent?: string;
  proxyUrl?: string;
  maxRetries?: number;
  retryDelay?: number;
  concurrency?: number;
  timeout?: number;
  /**
   * Poll interval in seconds for the built-in `getAll` poller. Default `60`.
   * `0` disables the timer. Otherwise a finite number `>= 5`.
   */
  fetchInterval?: number;
  /**
   * Resources skipped by the login/switch prefetch and by every poll tick.
   * Same values and validation as `getAll({ ignore })`. Default `[]`.
   */
  fetchIgnore?: Resource[];
  /** Online probe. Default: `navigator.onLine` where available, else online. */
  isOnline?: () => boolean;
  storage?: StorageAdapter;
  passkey?: string;
  offlineQueue?: boolean;
  onError?: ErrorMiddleware;
  on2faRequired?: (
    question: string,
    choices: string[],
  ) => number | string | Promise<number | string>;
  onCredentialsRequired?: () =>
    | { identifiant: string; motdepasse: string }
    | Promise<{ identifiant: string; motdepasse: string }>;
  /**
   * Prefix applied to every persisted storage key, so several instances can
   * share one storage adapter without overwriting each other. Default `''`.
   * Must be a string without whitespace.
   */
  storageNamespace?: string;
  /**
   * At most N request starts per rolling 60 seconds (sliding window).
   * Excess requests wait in FIFO order. `0` disables the limit.
   * Default `100` (conservative guess, EcoleDirecte's real limit is unknown).
   */
  maxRequestsPerMinute?: number;
}

/** Plain observer called with errors that are reported, never retried through it. */
type ErrorMiddleware = (error: any) => void | Promise<void>;
```

### `StorageAdapter`

The standard interface for defining custom data storage persistence.

```typescript
interface StorageAdapter {
  get(key: string): string | null | Promise<string | null>;
  set(key: string, value: string): void | Promise<void>;
  delete(key: string): void | Promise<void>;
}
```
