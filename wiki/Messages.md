<p align="center">
  <picture><source media="(prefers-color-scheme: light)" srcset="https://shieldcn.dev/header/glow.svg?title=Messages&amp;subtitle=Learn+how+to+interact+with+mail+with+Litedirecte.&amp;logo=lu%3AMessagesSquare&amp;mode=light&amp;theme=blue&amp;align=left" /><img alt="Messages | Learn how to interact with mail with Litedirecte." src="https://shieldcn.dev/header/glow.svg?title=Messages&amp;subtitle=Learn+how+to+interact+with+mail+with+Litedirecte.&amp;logo=lu%3AMessagesSquare&amp;mode=dark&amp;theme=blue&amp;align=left" /></picture>
</p>

The Messages module connects you directly to the school's communication channels. It handles reading received mail, viewing attachments, sending replies, and organizing drafts.

---

## 🚀 Getting Started

Let's fetch the list of received messages and read the most recent unread email.

```typescript
import { Litedirecte } from "litedirecte";

const ld = new Litedirecte();
await ld.auth.login("your_username", "your_password");

// Fetch the inbox (one request)
const inbox = await ld.messages.getMessages();
const unreadEmails = inbox.messages?.received?.filter(msg => !msg.read) ?? [];

console.log(`You have ${unreadEmails.length} unread message(s).`);

if (unreadEmails.length > 0) {
  const firstUnread = unreadEmails[0];
  console.log(`Reading: "${firstUnread.subject}" from ${firstUnread.fromName}...`);

  // Load full content (EcoleDirecte handles base64-decoded HTML automatically inside the SDK!).
  // Note: opening a message marks it as read on the server.
  const fullDetail = await ld.messages.getMessage(firstUnread.id);
  console.log("\nMessage body:");
  console.log(fullDetail.contenu);

  // Restore the unread state if needed:
  await ld.messages.markAsUnread(firstUnread.id);
}
```

---

## 📖 API Reference

### `ld.messages.getMessages`

Retrieves a directory of messages, in exactly **one** request. There is no `withContent` option: fetch bodies explicitly with `ld.messages.getMessage(id)`.

```typescript
ld.messages.getMessages(options?: GetMessagesOptions): Promise<any>
```

#### Parameters

- `options` *(optional)*:
  - `folderId` *(number)*: Pass a folder ID to retrieve messages from custom archives or folders.
  - `page` *(number)*: Zero-based page of the folder listing (`itemsPerPage=100`). Must be an integer `>= 0`; defaults to `0`. Throws `EdValidationError` otherwise.
  - `year` *(string)*: Restrict messages to a school year range. `undefined` or `''` means the default; anything else must match `AAAA-AAAA` **with consecutive years** (e.g. `2023-2024`), otherwise an `EdValidationError` is thrown.

---

### `ld.messages.getMessage`

Loads the detailed envelope and content body for a single message.

```typescript
ld.messages.getMessage(
  id: number,
  options?: GetMessageOptions,
): Promise<any>
```

#### Parameters

- `id` *(number)*: The unique ID of the message to retrieve.
- `options` *(optional)*:
  - `year` *(string)*: Same school-year rule as `getMessages`: `undefined`/`''` means the default, otherwise consecutive `AAAA-AAAA` years or `EdValidationError`.

> **Note**: Opening a message with `ld.messages.getMessage` automatically marks it as **read** on EcoleDirecte's servers. Call `ld.messages.markAsUnread(id)` to restore the unread state.

---

### `ld.messages.getContacts`

Lists the contacts you can write to — the recipient list for [`sendMessage`](#-ldmessagessendmessage). Each entry already carries the `id` and `type` pair `sendMessage` expects, so a contact can be passed straight through as a `destinataires` item.

```typescript
ld.messages.getContacts(options?: GetContactsOptions): Promise<any>
```

#### Parameters

- `options` *(optional)*:
  - `type` *(`'P' | 'A'`)*: Whom to list — `'P'` for teachers (default), `'A'` for school staff. EcoleDirecte returns one kind per request.
  - `classId` *(number)*: The class whose contacts are listed. Defaults to the logged-in account's class (`profile.classe.id` returned at login).
  - `force` *(boolean)*: Skip the cache and fetch from the network.
  - `mockMode` *(boolean)*: Return mock data without a network call.

> **Note:** Accounts with no class attached (staff, for instance) have no default `classId`; pass one explicitly, otherwise `EdValidationError` is thrown. The timetable exposes class ids in its `groupeId` fields if you need to discover one.

#### Example

```typescript
import { Litedirecte } from "litedirecte";

const ld = new Litedirecte();
await ld.auth.login("your_username", "your_password");

const { contacts } = await ld.messages.getContacts();
const teacher = contacts.find((c: any) => c.type === "P");

await ld.messages.sendMessage({
  subject: "Absence Excuse",
  content: "Hello, this is to inform you that...",
  destinataires: [teacher],
});
```

---

### `ld.messages.sendMessage`

Composes and sends a new message. Pass `files` with the `{ unc, libelle }`
pairs returned by [`uploadAttachment`](#-ldmessagesuploadattachment) to
attach files.

```typescript
ld.messages.sendMessage(
  data: SendMessageData,
): Promise<{ success: boolean }>
```

#### Example

```typescript
import { Litedirecte } from "litedirecte";

const ld = new Litedirecte();
await ld.auth.login("your_username", "your_password");

const result = await ld.messages.sendMessage({
  subject: "Absence Excuse",
  content: "Hello, this is to inform you that...",
  destinataires: [
    { id: 98765, type: "P" } // Target recipient object
  ]
});

if (result.success) {
  console.log("Message sent successfully!");
}
```

> **Accents**: `content` is HTML, and EcoleDirecte reads base64-decoded
> bytes as Latin-1 — raw UTF-8 accents would arrive as mojibake
> (`é` → `Ã©`). `sendMessage` therefore converts every non-ASCII character
> to a numeric HTML entity (`é` → `&#233;`) before encoding, keeping the
> payload pure ASCII. Entities render identically in every client.

---

### `ld.messages.uploadAttachment`

Uploads a file to EcoleDirecte's temporary stock (`POST /televersement.awp?verbe=post`, multipart field `file`). Returns the `{ unc, libelle }` pair to reference in [`sendMessage`](#-ldmessagessendmessage) — the file is **not** stored in the cloud, the temporary `unc` is consumed by the send.

```typescript
ld.messages.uploadAttachment(
  file: Blob,
  filename?: string,
): Promise<{ unc: string; libelle: string }>
```

#### Parameters

- `file` *(Blob | File)*: The file bytes. A `File` carries its own name.
- `filename` *(string, optional)*: Required when `file` is a plain `Blob` with no name.

#### Example

```typescript
import { Litedirecte } from "litedirecte";

const ld = new Litedirecte();
await ld.auth.login("your_username", "your_password");

const { contacts } = await ld.messages.getContacts();
const teacher = contacts.find((c: any) => c.type === "P");

// 1. Upload, 2. reference the temporary unc in the send.
const { unc, libelle } = await ld.messages.uploadAttachment(
  new File([await Bun.file("devoir.pdf").arrayBuffer()], "devoir.pdf")
);

await ld.messages.sendMessage({
  subject: "Devoir rendu",
  content: "Bonjour, voici mon devoir en pièce jointe.",
  destinataires: [teacher],
  files: [{ unc, libelle }],
});
```

---

### `ld.messages.markAsRead`

Marks one or several messages as read on EcoleDirecte's servers.

```typescript
ld.messages.markAsRead(
  ids: number | number[],
  options?: MarkMessageOptions,
): Promise<{ success: boolean }>
```

#### Parameters

- `ids` *(number | number[])*: A single message ID or an array of message IDs to mark as read.
- `options` *(optional)*:
  - `year` *(string)*: Same school-year rule as `getMessages`.
  - `mockMode` *(boolean)*: See [Configuration](../Configuration.md). When `true`, no network request is performed.

#### Example

```typescript
import { Litedirecte } from "litedirecte";

const ld = new Litedirecte();
await ld.auth.login("your_username", "your_password");

const result = await ld.messages.markAsRead([111, 222, 333]);
if (result.success) {
  console.log("Messages marked as read!");
}
```

---

### `ld.messages.markAsUnread`

Marks one or several messages as unread on EcoleDirecte's servers. Use it to restore the unread state after `ld.messages.getMessage` (which marks messages as read).

```typescript
ld.messages.markAsUnread(
  ids: number | number[],
  options?: MarkMessageOptions,
): Promise<{ success: boolean }>
```

#### Parameters

- `ids` *(number | number[])*: A single message ID or an array of message IDs to mark as unread.
- `options` *(optional)*:
  - `year` *(string)*: Same school-year rule as `getMessages`.
  - `mockMode` *(boolean)*: See [Configuration](../Configuration.md). When `true`, no network request is performed.

#### Example

```typescript
import { Litedirecte } from "litedirecte";

const ld = new Litedirecte();
await ld.auth.login("your_username", "your_password");

const result = await ld.messages.markAsUnread(12345);
if (result.success) {
  console.log("Message marked as unread!");
}
```

---

## 🗂️ Response Shape

`ld.messages.getMessages` and `ld.messages.getMessage` resolve to the raw EcoleDirecte API payload. Litedirecte does **not** translate or rename keys — the response keeps the API's original field names (only values are normalized: date strings become `Date`, and base64 fields such as `contenu`/`message` are decoded). Treat the return type as `any`.

### `SendMessageData`

```typescript
interface SendMessageData {
  subject: string;
  content: string;
  destinataires: Array<{
    id: number;
    type: string; // e.g. "P" (Teacher), "E" (Student)
    [key: string]: any;
  }>;
  /** From `uploadAttachment`: `{ unc, libelle, displayText? }`. */
  files?: Array<{
    unc: string;
    libelle: string;
    displayText?: string;
  }>;
}
```

---

## 💾 Caching

`getMessages()` for the default school year is maintained; folders, other years and pages, `getMessage(id)`, and `getContacts()` are manual (opening a message marks it read on the server, so details are never prefetched). `markAsRead` / `markAsUnread` patch cached lists, and `markAsUnread` drops the cached detail so the next `getMessage` reaches the server; `sendMessage` marks the resource stale or dead. Every read accepts `{ force: true }` to skip the cache. See [Cache & sync](Cache.md).
