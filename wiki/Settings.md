<p align="center">
  <picture><source media="(prefers-color-scheme: light)" srcset="https://shieldcn.dev/header/glow.svg?title=Settings&amp;subtitle=Learn+how+to+get+and+change+settings+with+Litedirecte.&amp;logo=lu%3ASettings&amp;mode=light&amp;theme=blue&amp;align=left" /><img alt="Settings | Learn how to get and change settings with Litedirecte." src="https://shieldcn.dev/header/glow.svg?title=Settings&amp;subtitle=Learn+how+to+get+and+change+settings+with+Litedirecte.&amp;logo=lu%3ASettings&amp;mode=dark&amp;theme=blue&amp;align=left" /></picture>
</p>

The Settings module allows you to view and adjust account properties, update user emails or phone numbers, change security answers, and configure accessibility settings (such as high-contrast themes) for the student.

---

## 🚀 Getting Started

Let's read the current user preferences and check out their registered details:

```typescript
import { Litedirecte } from "litedirecte";

const ld = new Litedirecte();
await ld.auth.login("your_username", "your_password");

// Retrieve active settings
const preferences = await ld.settings.getSettings();

console.log(`Identifier: ${preferences.identifiant}`);
console.log(`Registered Email: ${preferences.email}`);
console.log(`Mobile Phone: ${preferences.portable || "None specified"}`);

// Update user details (for example, setting a new email)
const updated = await ld.settings.updateSettings({
  email: "new.student@email.com",
});

console.log(`Email updated to: ${updated.email}`);
```

---

## 📖 API Reference

### `ld.settings.getSettings`

Fetches user login attributes and profile settings.

```typescript
ld.settings.getSettings(): Promise<any>
```

---

### `ld.settings.updateSettings`

Saves updated contact details, credentials, or security questions.

```typescript
ld.settings.updateSettings(
  data: {
    email?: string;
    portable?: string;              // French key for mobile phone
    questionSecrete?: string;       // French key for secret question
    reponse?: string;               // French key for response
    nouveauMotDePasse?: string;     // French key for new password
    identifiant?: string;           // Username identifier
  },
): Promise<any>
```

> **Note**: If you provide `nouveauMotDePasse` (new password) to change the account password, Litedirecte handles the required password confirmation payload parameters internally for you.

> **Note**: `ld.settings.updateSettings` is never queued for offline replay — a password change must never be persisted to, or replayed from, local storage.

---

### `ld.settings.updateAccessibility`

Enables or disables visual accessibility enhancements (e.g. high contrast or enlarged typography settings) inside EcoleDirecte.

```typescript
ld.settings.updateAccessibility(
  enabled: boolean,
): Promise<{ success: boolean }>
```

#### Example

```typescript
import { Litedirecte } from "litedirecte";

const ld = new Litedirecte();
await ld.auth.login("your_username", "your_password");

// Turn on visual accessibility features!
const result = await ld.settings.updateAccessibility(true);

if (result.success) {
  console.log("Visual accessibility preferences saved.");
}
```

---

## 🗂️ Response Shape

`ld.settings.getSettings` and `ld.settings.updateSettings` resolve to the raw EcoleDirecte API payload (treated as `any`). Litedirecte preserves the API's original key names and only normalizes values (date strings become `Date`, base64 fields are decoded).

---

## 💾 Caching

`getSettings()` is a maintained entry: served instantly and refreshed by the poller and by `ld.getAll()`. It accepts `{ force: true }` to skip the cache. See [Cache & sync](Cache.md).
