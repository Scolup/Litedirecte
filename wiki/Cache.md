<p align="center">
  <picture><source media="(prefers-color-scheme: light)" srcset="https://shieldcn.dev/header/glow.svg?title=Cache+%26+sync&amp;subtitle=Instant+reads%2C+background+refresh%2C+built-in+polling.&amp;logo=lu%3ADatabase&amp;mode=light&amp;theme=blue&amp;align=left" /><img alt="Cache & sync | Instant reads, background refresh, built-in polling." src="https://shieldcn.dev/header/glow.svg?title=Cache+%26+sync&amp;subtitle=Instant+reads%2C+background+refresh%2C+built-in+polling.&amp;logo=lu%3ADatabase&amp;mode=dark&amp;theme=blue&amp;align=left" /></picture>
</p>

Every read goes through one built-in, per-instance cache. Screens get local data instantly, the network only *refreshes* it, and a failed refresh never discards data you already have. The cache is **always on**: there is no opt-in and no per-resource tuning.

---

## 🧭 Fresh / stale / dead

A single exported constant drives everything: `CACHE_TTL_MS = 60_000`. An entry's age is `now - fetchedAt`.

| State | When | A read… |
| :--- | :--- | :--- |
| **fresh** | `age < 60_000` | is served with no request. |
| **stale** | `age >= 60_000`, **maintained** entries only | is served immediately while a background refresh runs. A failed refresh keeps the data and emits the cache `error` event. |
| **dead** | `age >= 60_000` for **manual** entries, `fetchedAt` in the future (clock moved backwards), or older than 30 days | is **never served while online**. The read waits for the network; if that fails, the read fails. Offline it is served anyway: see [📴 Offline](#-offline). |

Dead entries are deleted lazily (on read, when loading from storage, and after each `getAll`); there are no timers for it, and never while offline. The difference between stale and dead is the point of the design: maintained data is refreshed by the poller, so showing it instantly is safe; manual data has nobody refreshing it, so once it is older than the interval it must not be shown.

---

## 🗂️ Maintained vs manual data

An entry is **maintained** when its request is one of the requests `getAll` performs (see below) and its resource is not in `fetchIgnore`. Everything else is **manual**: one homework day, one message, a QCM detail, a far-away timetable week, a message folder or another school year, `getCloud` at another depth. In particular:

- timetable: only the Monday-to-Sunday weeks previous, current and next **relative to now**. When the week rolls over, the oldest of them stops being maintained and is treated as manual on its next read;
- `getMessages()` for the default school year, `getCloud()` at the default depth, and the list reads `getHomework()`, `getGrades()`, `getTimeline()`, `getCommonTimeline()`, `getAttendance()`, `getSettings()`, `getQcms()`, `getDocuments()` are maintained;
- a resource put in `fetchIgnore` is no longer polled, so it becomes manual (it dies after the interval). Calling `stopPolling()` does **not** change how data is served.

Keys are built from normalized arguments, so a default `getCloud()` and `getCloud({ depth: 3 })` are the same key, and a default `getMessages()` and `getMessages({ year: <default year> })` are the same key: a screen's call hits exactly the entry `getAll` stored.

What is cached: every `verbe=get` read that goes through the request layer (manual reads too — they simply die after the interval). Not cached: downloads, the token health check, login and 2FA, and `getTimetableIcalUrl`. The raw payload is cached, never the transformed one (`transform()` is not idempotent); results are shared and memoized, so treat them as **read-only**. Concurrent identical reads share one network request. `{ force: true }` on any read skips the cache, fetches, and writes the result through.

---

## 📦 `ld.getAll(options?)`

Fetches every resource in parallel, always from the network, as a background request, and writes each result to the cache. It is built in — not an option or a flag.

```typescript
const all = await ld.getAll({ ignore: ["cloud"] });
// { grades, timetable: { previous, current, next }, homework, messages,
//   timeline, commonTimeline, attendance, settings, qcms, documents, cloud,
//   errors, skipped }
```

- **What it fetches, exactly:** `timetable` as **three** Monday-to-Sunday weeks (`YYYY-MM-DD`: previous, current, next); `messages` as the message **list** for the default school year; `homework` as the **list** (index) only; `cloud` at the default depth; and the plain list reads for `grades`, `timeline`, `commonTimeline`, `attendance`, `settings`, `qcms` and `documents`.
- **What it never fetches:** individual messages (opening one marks it as read on the server), individual homework days, QCM details, the iCal URL, and timetable weeks other than the three above.
- **Result:** one failing resource never rejects `getAll` — it appears in `errors`. A resource whose module is unsupported goes into `skipped`, not `errors`. An unknown name in `ignore` throws `EdValidationError`.
- `getAll` rejects in three cases only: there is no active session; the session is unrecoverable; or the session ended while it ran (`EdAuthError` with code `SESSION_ENDED`).

---

## 🧲 Timetable neighbour prefetch

When `ld.timetable.getTimetable()` is called for a range that is **exactly one Monday-to-Sunday week**, the SDK readies the two neighbouring weeks afterwards: fresh neighbours are left alone, stale/dead/missing ones are fetched as fire-and-forget background requests. It never delays the requested week, never chains (a prefetched week does not prefetch its own neighbours), does not run for non-week ranges, offline, without a session, or after a session change, and failures are silent. Prefetched weeks outside the maintained three are manual entries: ready for the interval, then dead.

---

## 🔁 Polling is built in

Constructing the instance arms polling (state *running*) with the given or default interval. Arming a timer is not I/O; ticks do nothing until a session exists. Each tick calls `getAll({ ignore: fetchIgnore })`; each entry of the returned `errors` map is reported through the sync status and emitted once as `pollingError`. After a successful interactive login and after every `switchAccount()`, a background `getAll` prefetch runs (it never delays the call and never fails it; the refresh-internal login and session restore never prefetch).

```typescript
const ld = new Litedirecte({ fetchInterval: 30, fetchIgnore: ["cloud"] });

// Pause when the app goes to the background…
ld.stopPolling();

// …resume when it returns (restarts, re-times, catches up if stale).
ld.resumePolling();
```

- `fetchInterval` is in **seconds**. Default `60`. `0` disables the timer. Otherwise a finite number `>= 5`; anything else throws `EdValidationError` from the constructor, `configure()` and `resumePolling()`, leaving timer and settings untouched.
- `fetchIgnore` lists resources skipped by the login/switch prefetch and by every tick (same values and validation as `getAll`'s `ignore`). An explicit `getAll({ ignore })` or `login(..., { ignore })` argument wins over it.
- `stopPolling()` clears the timer (*stopped*); nothing restarts it except `resumePolling()`. `resumePolling(options?)` is the single way to resume and to change polling settings: it stores the options, re-creates the one timer, clears an authentication pause, and runs one catch-up tick immediately when the last successful `getAll` is older than the interval (never a burst). `ld.configure()` stores the values and re-times only while running. There is never more than one timer; it is `unref`'d and cleared by `ld.destroy()`.
- `logout()` and `clearSession()` do not stop the timer; ticks simply do nothing until a session exists again.

---

## 👀 `watch`, events and `ld.sync`

```typescript
const off = ld.cache.watch("grades", ({ resource, key }) => console.log("changed:", key));
const offEvent = ld.cache.onEvent((e) => console.log(e.type)); // update | invalidate | clear | error
const last = ld.cache.getLastSync("grades"); // Date | null
ld.cache.invalidate("grades"); // maintained -> stale, manual -> dead
await ld.cache.clear();
```

- `watch` fires only when stored data actually changed (an identical payload does not fire). The cache `update` event carries `{ resource, key }`. Entries dying fires nothing.
- `newGrade` / `newMessage` / `newTimelineEntry` come from the cache write: when a write replaces a previous **living** value for a maintained entry, items absent from the previous value are emitted. The first fetch only seeds the cache and emits nothing.
- One sync status: `ld.sync.getState()` returns `{ state, lastSync, lastError }` with `state` one of `'signed-out' | 'idle' | 'syncing' | 'offline' | 'error' | 'auth-required'`; `ld.sync.onChange(cb)` subscribes. It starts as `signed-out`, becomes `idle` after login or `loadSession`, and returns to `signed-out` after `logout`. `syncing` means a `getAll` is in flight. `offline` means no request was possible: a tick found no network, or a read was served straight from the cache (see [📴 Offline](#-offline)). A failure is reported through the sync status and at most one older channel (`pollingError` for polls, the cache `error` event for background revalidations). Apps should watch `ld.sync` for `auth-required` (see [Authentication](Authentication.md)).

---

## 📴 Offline

```typescript
const ld = new Litedirecte({ isOnline: () => navigator.onLine });
```

Default: `navigator.onLine` where `navigator` exists and `onLine` is a boolean (guarded; never throws on Node, Bun, Deno, Hermes or edge runtimes), otherwise assume online. When offline, requests are not attempted.

- **A read is served the newest copy the cache holds, whatever its age** — fresh, stale or dead. Nothing can refresh it while the network is down, so it is the answer. `getMessage(1234)` an hour after you opened it still returns the message instead of throwing.
- **It is never silent**: the served read flips the sync status to `offline` (once per transition, with an `EdOfflineError` as `lastError`), so `ld.sync.onChange` and `ld.sync.getState()` tell the app the data is not live. The read itself resolves, so watch `ld.sync` to show an offline banner.
- **Only a read with nothing cached rejects**, immediately, with `EdOfflineError` (extends `EdNetworkError`, never retried). `{ force: true }` also rejects offline: forcing a refresh is an explicit request for the network, and there is nothing to fall back to.
- Dead entries are **not pruned while offline** (nothing could replace them), so `getAll()` — which always forces a network read and reports one `EdOfflineError` per resource in `errors` — never destroys the copy you have.
- Back online, the next read of a dead entry drops it and refetches from EcoleDirecte.

Mutations still go through the offline queue as usual (see [Configuration](Configuration.md)).

---

## 🔐 Sessions, logout and storage

- Every session change (`logout`, `clearSession`, `switchAccount`, a login as another account, `destroy`) increments the instance's session generation. A late response arriving under an older generation is abandoned: nothing is cached, no event or sync update is produced, and a waiter rejects with `EdAuthError` code `SESSION_ENDED`. A successful token refresh is **not** a session change.
- `logout()` and `clearSession()` purge memory and storage for every account of that instance. Everything is per instance: cache keys always include the account id explicitly (even `getDocuments`, whose endpoint has none) and use `storageNamespace`; data persists through the instance's `storage`, so `passkey` encryption applies. Two instances never share entries. A storage failure never breaks a read (reported through `onError`). At most 300 entries are kept in memory (least recently used evicted).
- Mutations keep the cache correct: `markAsDone` / `markAsUndone` patch the cached homework in place (no refetch); `markAsRead` / `markAsUnread` patch message lists, and `markAsUnread` drops the cached message detail so the next `getMessage` reaches the server; `sendMessage` and `sendHomeworkComment` mark their resource stale (maintained) or dead (manual).
