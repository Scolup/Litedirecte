<p align="center">
  <picture><source media="(prefers-color-scheme: light)" srcset="https://shieldcn.dev/header/glow.svg?title=Event+listening&amp;subtitle=Learn+how+to+listen+for+events+with+Litedirecte.&amp;logo=lu%3ABell&amp;mode=light&amp;theme=blue&amp;align=left" /><img alt="Event listening | Learn how to listen for events with Litedirecte." src="https://shieldcn.dev/header/glow.svg?title=Event+listening&amp;subtitle=Learn+how+to+listen+for+events+with+Litedirecte.&amp;logo=lu%3ABell&amp;mode=dark&amp;theme=blue&amp;align=left" /></picture>
</p>

The Listen module provides a simple event system that lets you poll EcoleDirecte for changes and respond immediately when something new happens, like receiving a brand-new grade, a message, or a new school activity! Polling is built in: constructing the instance arms it, and every tick refreshes all resources through the cache (see [Cache & sync](Cache.md)).

---

## 🚀 Getting Started

Polling starts at construction — just subscribe and log in.

```typescript
import { Litedirecte } from "litedirecte";

const ld = new Litedirecte({ fetchInterval: 30 });
await ld.auth.login("your_username", "your_password");

// The `new*` payloads are the raw decoded EcoleDirecte objects, so declare the
// shape you expect once and let the assertion do the rest.
interface Grade {
  valeur: string;
  noteSur: number;
  libelleMatiere: string;
}

// 1. Listen for new grades
const unsubscribeGrades = ld.on("newGrade", (payload) => {
  const grade = payload as Grade;
  console.log(`🎉 New Grade Posted! ${grade.valeur}/${grade.noteSur} in ${grade.libelleMatiere}`);
});

// 2. Listen for new messages
ld.on("newMessage", (payload) => {
  const message = payload as { fromName?: string; subject?: string };
  console.log(`✉️ New Message from ${message.fromName || "Unknown"}: "${message.subject}"`);
});

// 3. Listen for new timeline entries
ld.on("newTimelineEntry", (payload) => {
  const entry = payload as { typeElement?: string; titre?: string };
  console.log(`📅 New Activity: [${entry.typeElement}] ${entry.titre}`);
});

// 4. Listen for polling errors (useful if servers go down)
ld.on("pollingError", (error) => {
  // `error` is an `EdError`, so `.code` is available without a cast
  console.error(`⚠️ An error occurred while polling: [${error.code}]`, error);
});

// 5. Pause when the app goes to the background, resume when it returns.
ld.stopPolling();
ld.resumePolling();
```

---

## 📖 API Reference

### Built-in polling

There is no `startPolling`: `new Litedirecte({ fetchInterval, fetchIgnore })` arms the one timer (state *running*), `ld.stopPolling()` stops it, and `ld.resumePolling(options?)` is the single way to resume it and to change polling settings. `ld.configure()` stores `fetchInterval` / `fetchIgnore` and re-times only while running. Each tick calls `getAll({ ignore: fetchIgnore })`; each entry of the returned `errors` map is reported through the sync status and emitted once as `pollingError`. After login and account switch, a background `getAll` prefetch runs for the new session.

**First-fetch baseline:** the first fetch for an account only seeds the cache — nothing is emitted. You receive events only for items that appear *after* the baseline.

**Scope:** ticks refresh every resource `getAll` fetches (grades, timetable weeks, homework, messages, timelines, attendance, settings, QCMs, documents, cloud). A tick with no active account does nothing: no request, no event. Ticks while offline do nothing and the state is `offline`. Polling is per instance: two `Litedirecte` instances poll independently.

**`new*` events come from the cache write:** when a write replaces a previous living value for a maintained grades, messages or timeline entry, items absent from the previous value are emitted (`newGrade` / `newMessage` / `newTimelineEntry`). Manual entries never emit them.

**Listener errors are isolated:** each handler runs in its own try/catch. A throwing handler never blocks other handlers, never aborts the diff, and never surfaces as `pollingError`; the error is forwarded to `config.onError` when set, otherwise ignored.

---

### `ld.stopPolling`

Stops ticks. Clears the timer and sets the state to stopped; nothing restarts it except `resumePolling()`.

```typescript
ld.stopPolling(): void
```

---

### `ld.resumePolling`

Resumes polling and optionally changes polling settings. Idempotent; there is never more than one timer. Clears an authentication pause. When the last successful `getAll` is older than the interval (or there is none), one tick runs immediately — repeated calls never burst.

```typescript
ld.resumePolling(options?: { fetchInterval?: number; fetchIgnore?: Resource[] }): void
```

### `ld.cache.watch` and `ld.sync`

`ld.cache.watch(resources, callback)` fires `callback({ resource, key })` only when stored data for that resource actually changed. `ld.sync.getState()` returns the one sync status (`signed-out` | `idle` | `syncing` | `offline` | `error` | `auth-required`); `ld.sync.onChange(cb)` subscribes. See [Cache & sync](Cache.md).

### `ld.on`

Registers a listener function for a specific event.

```typescript
ld.on<T extends LitedirecteEvent>(event: T, handler: EventHandler<LitedirecteEvents[T]>): () => void
```

#### Parameters
- `event` *(string)*: The event name to listen for (see [Event Types Reference](#-event-types-reference)).
- `handler` *(`(data: any) => void`)*: Callback invoked with the event payload whenever the event fires. The payload type follows the event name, so a `pollingError` handler receives an `Error` you can read `.code` off directly.

#### Returns
An unsubscribe function. Call it to quickly remove the listener and clean up memory!

```typescript
const unsubscribe = ld.on("newGrade", (g) => console.log(g));

// Stop listening later
unsubscribe();
```

---

### `ld.off`

Explicitly removes a previously registered listener. You must pass the same function reference that was originally passed to `on`.

```typescript
ld.off<T extends LitedirecteEvent>(event: T, handler: EventHandler<LitedirecteEvents[T]>): void
```

#### Parameters
- `event` *(string)*: The event name the handler was registered under.
- `handler` *(`(data: any) => void`)*: The exact function reference originally passed to `on`.

```typescript
const handler = (payload: unknown) => console.log(payload);
ld.on("newGrade", handler);

// Remove later - same reference required
ld.off("newGrade", handler);
```

> **Tip:** Prefer the unsubscribe function returned by `ld.on` when you only need to remove a single listener. Use `ld.off` when you need to remove a listener without holding onto the unsubscribe closure. `ld.destroy()` removes every listener at once.

---

## 🗂️ Event Types Reference

Litedirecte processes changes across multiple student channels. You can subscribe to these events:

| Event | Emitted When | Payload Type |
| :--- | :--- | :--- |
| `"newGrade"` | A new grade is entered into the system. | raw grade object (`unknown`) |
| `"newMessage"` | A new message is received in the student's mailbox. | raw message object (`unknown`) |
| `"newTimelineEntry"` | A new event occurs on the student's activity feed. | raw timeline object (`unknown`) |
| `"pollingError"` | An API fetch fails due to credentials, token expiry, or a network timeout. | `EdError` |

The names and payload types are exported so you can type your own wrappers:

```typescript
import { Litedirecte, type LitedirecteEvent, type LitedirecteEvents } from "litedirecte";

const EVENTS: LitedirecteEvent[] = ["newGrade", "newMessage", "newTimelineEntry", "pollingError"];

ld.on("pollingError", (error) => {
  // `error` is an Error here, so `code` is reachable without a cast
  if (error.code === "RATE_LIMIT") scheduleBackoff();
});
```

> **Note:** the `new*` payloads are the decoded EcoleDirecte objects. They carry no static type because the API defines none, so they are `unknown` rather than `any` — narrow them at your call site (`(g) => (g as Grade).noteSur`) or with a type guard. Nothing is lost: `any` was the old behaviour, so any code that reads a field still compiles.
