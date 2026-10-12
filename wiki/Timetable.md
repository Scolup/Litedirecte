<p align="center">
  <picture><source media="(prefers-color-scheme: light)" srcset="https://shieldcn.dev/header/glow.svg?title=Timetable&amp;subtitle=Learn+how+to+get+the+timetable+with+Litedirecte.&amp;logo=lu%3ACalendar&amp;mode=light&amp;theme=blue&amp;align=left" /><img alt="Timetable | Learn how to get the timetable with Litedirecte." src="https://shieldcn.dev/header/glow.svg?title=Timetable&amp;subtitle=Learn+how+to+get+the+timetable+with+Litedirecte.&amp;logo=lu%3ACalendar&amp;mode=dark&amp;theme=blue&amp;align=left" /></picture>
</p>

The Timetable module fetches, parses, and normalizes the student's calendar. It also allows you to retrieve a subscription URL for external calendar systems (Apple Calendar, Google Calendar, Outlook, etc.).

---

## 🚀 Getting Started

Let's fetch the student's timetable classes for the upcoming week:

```typescript
import { Litedirecte } from "litedirecte";

const ld = new Litedirecte();
await ld.auth.login("your_username", "your_password");

const schedule = await ld.timetable.getTimetable({
  startDate: new Date(), // Start today
  endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Next 7 days
});

console.log(`Loaded ${schedule.timetable.length} timetable events.`);

schedule.timetable.forEach(classSession => {
  const status = classSession.isAnnule ? "❌ CANCELLED" : "✅ ACTIVE";
  console.log(`\n[${status}] Subject: ${classSession.matiere}`);
  console.log(`  Time: ${classSession.start_date.toLocaleTimeString()} - ${classSession.end_date.toLocaleTimeString()}`);
  console.log(`  Room: ${classSession.salle || "No room assigned"}`);
  console.log(`  Teacher: ${classSession.prof || "Unspecified teacher"}`);
});
```

Let's fetch an iCal subscription link:

```typescript
import { Litedirecte } from "litedirecte";

const ld = new Litedirecte();
await ld.auth.login("your_username", "your_password");

const calendarUrl = await ld.timetable.getTimetableIcalUrl();
console.log("Add this link to your Google or Apple Calendar subscription feed:");
console.log(calendarUrl);
```

---

## 📖 API Reference

### `ld.timetable.getTimetable`

Retrieves a chronologically ordered array of scheduled class sessions.

```typescript
ld.timetable.getTimetable(options?: {
  startDate?: string | Date;
  endDate?: string | Date;
}): Promise<any>
```

#### Parameters

- `options` *(optional)*:
  - `startDate` *(string | Date)*: The beginning of the timetable window. Can be a standard JavaScript `Date` object or an ISO-style date string (`"YYYY-MM-DD"`). Defaults to today.
  - `endDate` *(string | Date)*: The end of the timetable window. Defaults to the same value as `startDate`.

Invalid dates, or an `endDate` before `startDate`, throw an `EdValidationError` and nothing is requested.

---

### `ld.timetable.getTimetableIcalUrl`

Retrieves the URL for the student's timetable in iCal format for integration with external calendar systems.

```typescript
ld.timetable.getTimetableIcalUrl(): Promise<string>
```

---

## 🗂️ Response Shape

`ld.timetable.getTimetable` resolves to the raw EcoleDirecte API payload (treated as `any`). Litedirecte preserves the API's original key names (e.g. `start_date`, `end_date`, `codeMatiere`) and only normalizes values (date strings become `Date`, base64 fields are decoded).

Requires the `EDT` module on the current account (see [Configuration](Configuration.md#module-support)): without it, an `EdUnsupportedModuleError` is thrown before any request.

---

## 💾 Caching

Only the previous, current and next Monday-to-Sunday weeks are maintained entries. Other ranges are manual entries. Reading exactly one Monday-to-Sunday week also readies its two neighbours in the background (silent, never chained). `getTimetableIcalUrl()` is never cached. Every read accepts `{ force: true }` to skip the cache. See [Cache & sync](Cache.md).
