<p align="center">
  <picture><source media="(prefers-color-scheme: light)" srcset="https://shieldcn.dev/header/glow.svg?title=Documents&amp;subtitle=Learn+how+to+get+documents+with+Litedirecte.&amp;logo=lu%3AFileText&amp;mode=light&amp;theme=blue&amp;align=left" /><img alt="Documents | Learn how to get documents with Litedirecte." src="https://shieldcn.dev/header/glow.svg?title=Documents&amp;subtitle=Learn+how+to+get+documents+with+Litedirecte.&amp;logo=lu%3AFileText&amp;mode=dark&amp;theme=blue&amp;align=left" /></picture>
</p>

The Documents module provides access to official school documents.

---

## 🚀 Getting Started

Let's retrieve the list of available school documents and see what's ready to download.

```typescript
import { Litedirecte } from "litedirecte";
import { writeFile } from "node:fs/promises";

const ld = new Litedirecte();
await ld.auth.login("your_username", "your_password");

// Fetch lists of invoices, report cards, etc.
const result = await ld.documents.getDocuments();

// Check if any report cards are available under the "notes" document array
const latestReportCard = result.notes?.[0];

if (latestReportCard) {
  console.log(`Downloading report card: ${latestReportCard.libelle}...`);

  // To download documents, send a post request to the download endpoint using the document ID and type
  const fileData = await ld.downloads.download({
    as: "buffer",
    params: {
      forceDownload: 0,
      id: latestReportCard.id,
      type: latestReportCard.type,
    },
  });

  // Save it locally!
  await writeFile(`./${latestReportCard.libelle}.pdf`, Buffer.from(fileData));
  console.log("Download complete!");
} else {
  console.log("No report cards available to download.");
}
```

---

## 📖 API Reference

### `ld.documents.getDocuments`

Fetches categorized folders of files made available to the student.

```typescript
ld.documents.getDocuments(): Promise<any>
```

#### Returns

A promise that resolves to the raw EcoleDirecte API payload (treated as `any`), with document lists grouped by category. Litedirecte preserves the API's original key names and only normalizes values (date strings become `Date`, base64 fields are decoded).

---

## 🗂️ Response Shape

`ld.documents.getDocuments` resolves to the raw EcoleDirecte API payload (treated as `any`). Documents are categorized into buckets such as `factures`, `notes`, `viescolaire`, and `administratifs`, each an array of document objects. Litedirecte preserves the API's original key names and only normalizes values (date strings become `Date`, base64 fields are decoded).

---

## 💾 Caching

`getDocuments()` is a maintained entry (its cache key includes the account id explicitly, even though the endpoint has none). It accepts `{ force: true }` to skip the cache. See [Cache & sync](Cache.md).
