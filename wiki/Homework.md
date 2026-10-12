<p align="center">
  <picture><source media="(prefers-color-scheme: light)" srcset="https://shieldcn.dev/header/glow.svg?title=Homework+%26+session+content&amp;subtitle=Learn+how+to+get+homework+and+session+content+with+Litedirecte.&amp;logo=lu%3ANotebook&amp;mode=light&amp;theme=blue&amp;align=left" /><img alt="Homework &amp; Session content | Learn how to get homework and session content with Litedirecte." src="https://shieldcn.dev/header/glow.svg?title=Homework+%26+session+content&amp;subtitle=Learn+how+to+get+homework+and+session+content+with+Litedirecte.&amp;logo=lu%3ANotebook&amp;mode=dark&amp;theme=blue&amp;align=left" /></picture>
</p>

The Homework module gives you access to the student's textbook. It allows you to fetch homework, session content, and mark tasks as done (even when offline!).

---

## 🚀 Getting Started

Let's read all assignments scheduled for the coming days:

```typescript
import { Litedirecte } from "litedirecte";

const ld = new Litedirecte();
await ld.auth.login("your_username", "your_password");

// Retrieve the homework index (one request)…
const calendar = await ld.homework.getHomework();

for (const [date, assignments] of Object.entries(calendar)) {
  console.log(`\n📅 Assignments for ${date}:`);

  // …then load details per date explicitly.
  const detail = await ld.homework.getHomeworkForDate(date);
  for (const task of detail.matieres ?? []) {
    console.log(`- [${task.matiere}] ${task.aFaire?.contenu ?? "(see session content)"}`);
  }
}
```

---

## 📖 API Reference

### `ld.homework.getHomework`

Fetches a calendar index of homework due over the next few weeks, in exactly **one** request. There is no `withContent` option: call `ld.homework.getHomeworkForDate(date)` for each date you want details for.

```typescript
ld.homework.getHomework(): Promise<any>
```

#### Returns

A promise resolving to the raw EcoleDirecte API payload (treated as `any`), keyed by date strings (`"YYYY-MM-DD"`) with arrays of assignment objects. Litedirecte preserves the API's original key names and only normalizes values (date strings become `Date`, base64 fields are decoded).

---

### `ld.homework.getHomeworkForDate`

Loads detailed descriptions and resources for a specific day.

```typescript
ld.homework.getHomeworkForDate(
  date: string | Date,
): Promise<any>
```

#### Example

```typescript
import { Litedirecte } from "litedirecte";

const ld = new Litedirecte();
await ld.auth.login("your_username", "your_password");

const assignments = await ld.homework.getHomeworkForDate("2025-09-15");
assignments.forEach(task => {
  console.log(`Teacher: ${task.nomProf ?? "Unknown"}`);
  console.log(`Content (HTML): ${task.aFaire?.contenu}`);
});
```

---

### `ld.homework.markAsDone`

Updates the state of one or more homework assignments to completed.

```typescript
ld.homework.markAsDone(
  homeworkIds: number[],
): Promise<any>
```

Every id must be a positive integer, otherwise an `EdValidationError` is thrown and nothing is requested.

---

### `ld.homework.markAsUndone`

The inverse of `markAsDone`: moves one or more assignments back to *not completed*.

```typescript
ld.homework.markAsUndone(
  homeworkIds: number[],
): Promise<any>
```

#### Example

```typescript
import { Litedirecte } from "litedirecte";

const ld = new Litedirecte();
await ld.auth.login("your_username", "your_password");

await ld.homework.markAsDone([11243]);   // ticked by mistake…
await ld.homework.markAsUndone([11243]); // …and put back on the to-do list
```

Both calls hit the same endpoint and are queued, so they still work offline.

---

### `ld.homework.sendHomeworkComment`

Post a comment under a homework assignment or a session content.

```typescript
ld.homework.sendHomeworkComment(
  idContenu: number,
  message: string,
): Promise<{ id: number }>
```

#### Example

```typescript
import { Litedirecte } from "litedirecte";

const ld = new Litedirecte();
await ld.auth.login("your_username", "your_password");

const result = await ld.homework.sendHomeworkComment(55442, "Here is my comment on the homework");
console.log(`Comment posted successfully with ID: ${result.id}`);
```

---

## 🗂️ Response Shape

`ld.homework.getHomework`, `ld.homework.getHomeworkForDate`, `ld.homework.markAsDone`, and `ld.homework.markAsUndone` resolve to the raw EcoleDirecte API payload (treated as `any`). Litedirecte preserves the API's original key names and only normalizes values (date strings become `Date`, base64 fields are decoded).

Requires the `CAHIER_DE_TEXTES` module on the current account (see [Configuration](Configuration.md#module-support)): without it, an `EdUnsupportedModuleError` is thrown before any request.

---

## 💾 Caching

`getHomework()` (the list) is maintained; `getHomeworkForDate(date)` is manual. `markAsDone` / `markAsUndone` patch the cached homework in place with no refetch; `sendHomeworkComment` marks the resource stale (maintained) or dead (manual). Every read accepts `{ force: true }` to skip the cache. See [Cache & sync](Cache.md).
