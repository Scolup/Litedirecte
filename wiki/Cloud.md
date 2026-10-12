<p align="center">
  <picture><source media="(prefers-color-scheme: light)" srcset="https://shieldcn.dev/header/glow.svg?title=Cloud&amp;subtitle=Learn+how+to+get+cloud+data+with+Litedirecte.&amp;logo=lu%3ACloud&amp;mode=light&amp;theme=blue&amp;align=left" /><img alt="Cloud | Learn how to get cloud data with Litedirecte." src="https://shieldcn.dev/header/glow.svg?title=Cloud&amp;subtitle=Learn+how+to+get+cloud+data+with+Litedirecte.&amp;logo=lu%3ACloud&amp;mode=dark&amp;theme=blue&amp;align=left" /></picture>
</p>

The Cloud module gives you full access to EcoleDirecte's personal cloud storage.

---

## 🚀 Getting Started

Let's fetch the contents of the student's personal cloud and traverse the folder structure.

```typescript
import { Litedirecte } from "litedirecte";

const ld = new Litedirecte();
await ld.auth.login("your_username", "your_password");

// Retrieve the files and folders up to a depth of 3 folders deep
const cloudItems = await ld.cloud.getCloud({ depth: 3 });

console.log(`You have ${cloudItems.length} top-level files or folders.`);

cloudItems.forEach(item => {
  if (item.type === "folder") {
    console.log(`📁 Folder: ${item.libelle} (contains ${item.children?.length ?? 0} items)`);
  } else {
    console.log(`📄 File: ${item.libelle} (${(item.taille / 1024).toFixed(1)} KB)`);
  }
});
```

---

## 📖 API Reference

### `ld.cloud.getCloud`

Fetches all files and folders available in the student's personal space.

```typescript
ld.cloud.getCloud(options?: GetCloudOptions): Promise<CloudEntry[]>
```

#### Parameters

- `options` *(optional)*:
  - `depth` *(number)*: How many folders deep the SDK should scan and build children arrays for. Defaults to `3`. Must be an integer between 1 and 10, otherwise an `EdValidationError` is thrown and nothing is requested.

---

### `ld.cloud.createFolder`

Creates a new folder under a parent directory.

```typescript
ld.cloud.createFolder(
  name: string,
  parentNode: CloudNode,
): Promise<CloudNode>
```

#### Parameters

- `name` *(string)*: The name for your new folder.
- `parentNode` *(CloudNode)*: The folder node where your new folder should be created.

#### Example

```typescript
import { Litedirecte } from "litedirecte";

const ld = new Litedirecte();
await ld.auth.login("your_username", "your_password");

const tree = await ld.cloud.getCloud();
const myParentFolder = tree.find(node => node.type === "folder" && node.libelle === "My Documents");

if (myParentFolder) {
  const newFolder = await ld.cloud.createFolder("Math Homework", myParentFolder);
  console.log(`Successfully created folder: ${newFolder.libelle}`);
}
```

---

### `ld.cloud.deleteNodes`

Moves files or folders to the Recycle Bin / Trash.

```typescript
ld.cloud.deleteNodes(
  nodes: CloudNode[],
): Promise<{ success: boolean }>
```

#### Parameters

- `nodes` *(CloudNode[])*: An array of file or folder nodes to delete.

#### Example

```typescript
import { Litedirecte } from "litedirecte";

const ld = new Litedirecte();
await ld.auth.login("your_username", "your_password");

const tree = await ld.cloud.getCloud();
const oldFile = tree.find(node => node.type === "file" && node.libelle === "temporary_draft.txt");

if (oldFile) {
  const result = await ld.cloud.deleteNodes([oldFile]);
  if (result.success) {
    console.log("File successfully moved to trash!");
  }
}
```

---

## 🗂️ Type Definitions

### `CloudNode`

Represents either a folder or a file inside the EcoleDirecte cloud:

```typescript
interface CloudNode {
  id: string;               // Unique string ID of the file or folder
  type: "file" | "folder";  // Node type
  libelle: string;          // Name of the file or folder (raw key)
  date: string;             // Date string when created or updated
  taille: number;           // File size in bytes (raw key)
  readonly: boolean;        // True if the node is write-protected (raw key)
  hidden: boolean;          // True if the item is hidden (raw key)
  isTrash: boolean;         // True if the item is currently in the trash
  isLoaded?: boolean;       // Indicates if subfolders have been loaded
  quota?: number;           // Space limit in bytes (usually present on top folder)
  displayText?: string;     // Friendly display string
  children?: CloudNode[];   // Child nodes (if a folder)
  proprietaire?: {          // Owner metadata object (raw key)
    id: number;
    type: string;
    nom: string;
    prenom: string;
    particule: string;
  };
}
```

### `CloudEntry`

A simple union representing the entries returned:

```typescript
type CloudEntry = CloudFolderNode | CloudFileNode;

interface CloudFolderNode extends CloudNode {
  type: "folder";
  children: CloudNode[];
}

interface CloudFileNode extends CloudNode {
  type: "file";
}
```

---

## 💾 Caching

`getCloud()` at the default depth is maintained; other depths are manual entries. Reads accept `{ force: true }` to skip the cache. See [Cache & sync](Cache.md).
