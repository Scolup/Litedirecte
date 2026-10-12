<p align="center">
  <picture><source media="(prefers-color-scheme: light)" srcset="https://shieldcn.dev/header/glow.svg?title=Attendance&amp;subtitle=Learn+how+to+get+attendance+data+with+Litedirecte.&amp;logo=lu%3AUser&amp;mode=light&amp;theme=blue&amp;align=left" /><img alt="Attendance | Learn how to get attendance data with Litedirecte." src="https://shieldcn.dev/header/glow.svg?title=Attendance&amp;subtitle=Learn+how+to+get+attendance+data+with+Litedirecte.&amp;logo=lu%3AUser&amp;mode=dark&amp;theme=blue&amp;align=left" /></picture>
</p>

The attendance module makes it super easy to check on a student's absences, delays, and any disciplinary events (like punishments) in EcoleDirecte.

## 🚀 Getting Started

To fetch attendance, you'll use the `getAttendance` function.

```typescript
import { Litedirecte } from "litedirecte";

const ld = new Litedirecte();
await ld.auth.login("your_username", "your_password");

const data = await ld.attendance.getAttendance();

if (data.absences && data.absences.length > 0) {
  console.log(`Oh! You have ${data.absences.length} registered absence(s).`);
  data.absences.forEach(absence => {
    console.log(`- Date: ${absence.date.toLocaleDateString()} | Reason: ${absence.motif || "No reason specified"}`);
  });
} else {
  console.log("Hooray! No absences recorded.");
}
```

---

## 📖 API Reference

### `ld.attendance.getAttendance`

Fetches the student's full attendance history, including delays and punishments.

```typescript
ld.attendance.getAttendance(): Promise<any>
```

#### Returns

A promise that resolves to the raw EcoleDirecte API payload (treated as `any`), with attendance events grouped into buckets such as `absences`, `delays`, `punishments`, and `attendance`. Litedirecte preserves the API's original key names and only normalizes values (date strings become `Date`, base64 fields are decoded).

---

## 🗂️ Response Shape

`ld.attendance.getAttendance` resolves to the raw EcoleDirecte API payload (treated as `any`). Litedirecte preserves the API's original key names and only normalizes values (date strings become `Date`, base64 fields are decoded).

Requires the `VIE_SCOLAIRE` module on the current account (see [Configuration](Configuration.md#module-support)): without it, an `EdUnsupportedModuleError` is thrown before any request.

---

## 💾 Caching

`getAttendance()` is a maintained entry: served instantly and refreshed by the poller and by `ld.getAll()`. It accepts `{ force: true }` to skip the cache. See [Cache & sync](Cache.md).
