<p align="center">
  <picture><source media="(prefers-color-scheme: light)" srcset="https://shieldcn.dev/header/glow.svg?title=Grades&amp;subtitle=Learn+how+to+get+grades+data+with+Litedirecte.&amp;logo=lu%3AGraduationCap&amp;mode=light&amp;theme=blue&amp;align=left" /><img alt="Grades | Learn how to get grades data with Litedirecte." src="https://shieldcn.dev/header/glow.svg?title=Grades&amp;subtitle=Learn+how+to+get+grades+data+with+Litedirecte.&amp;logo=lu%3AGraduationCap&amp;mode=dark&amp;theme=blue&amp;align=left" /></picture>
</p>

The Grades module provides access to a student's grades, averages, and subject performance metrics. It retrieves the data directly from EcoleDirecte, returning the raw structured grade entries and term/period details.

---

## 🚀 Getting Started

Here's how to fetch your latest grades and output them grouped by subject:

```typescript
import { Litedirecte } from "litedirecte";

const ld = new Litedirecte();
await ld.auth.login("your_username", "your_password");

const result = await ld.grades.getGrades();

console.log(`Successfully loaded ${result.notes.length} grades!`);

// Group grades by subject manually using raw keys
const gradesBySubject = new Map<string, typeof result.notes>();
for (const grade of result.notes) {
  const list = gradesBySubject.get(grade.libelleMatiere) || [];
  list.push(grade);
  gradesBySubject.set(grade.libelleMatiere, list);
}

gradesBySubject.forEach((grades, subjectName) => {
  console.log(`--- ${subjectName} ---`);
  grades.forEach(grade => {
    console.log(`  • ${grade.valeur}/${grade.noteSur} (Coeff: ${grade.coef})`);
  });
});
```

---

## 📖 API Reference

### `ld.grades.getGrades`

Fetches grades and statistics for either the current school period or a specific year.

```typescript
ld.grades.getGrades(options?: {
  periodId?: string;
}): Promise<any>
```

#### Parameters

- `options` *(optional)*:
  - `periodId` *(string)*: Focuses the query on a specific school term or period (e.g. `"A001"`). If not specified, returns grades across all available periods for the current year.

> **Note:** despite its name, `periodId` is sent to the API as the `anneeScolaire` request field (which reads as a *school year*, not a period). The SDK does not reinterpret it: the value is forwarded verbatim. If the real API expects a year here rather than a period id, pass a year string — this ambiguity is known and kept as-is until the API contract is clarified.

#### Returns

A promise that resolves to the raw EcoleDirecte API payload (treated as `any`). Litedirecte preserves the API's original key names and only normalizes values (date strings become `Date`, base64 fields are decoded).

---

## 🗂️ Response Shape

`ld.grades.getGrades` resolves to the raw EcoleDirecte API payload (treated as `any`). Litedirecte preserves the API's original key names and only normalizes values (date strings become `Date`, base64 fields are decoded).

Requires the `NOTES` module on the current account (see [Configuration](Configuration.md#module-support)): without it, an `EdUnsupportedModuleError` is thrown before any request.

---

## 💾 Caching

`getGrades()` (default period) is a maintained entry: served instantly and refreshed by the poller and by `ld.getAll()`. Other periods are manual entries: served within the interval, then never shown until refetched. Every read accepts `{ force: true }` to skip the cache. See [Cache & sync](Cache.md).
