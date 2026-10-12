<p align="center">
  <picture><source media="(prefers-color-scheme: light)" srcset="https://shieldcn.dev/header/glow.svg?title=QCMs&amp;subtitle=Learn+how+to+get+QCM+data+with+Litedirecte.&amp;logo=lu%3AMailQuestion&amp;mode=light&amp;theme=blue&amp;align=left" /><img alt="QCMs | Learn how to get QCM data with Litedirecte." src="https://shieldcn.dev/header/glow.svg?title=QCMs&amp;subtitle=Learn+how+to+get+QCM+data+with+Litedirecte.&amp;logo=lu%3AMailQuestion&amp;mode=dark&amp;theme=blue&amp;align=left" /></picture>
</p>

The Forms/QCMs module manages online assessments, questionnaires, and multi-choice quizzes (QCMs) assigned to students by teachers.

---

## 🚀 Getting Started

Here's how to fetch assigned quizzes, inspect their structures, and respond to questions.

```typescript
import { Litedirecte } from "litedirecte";

const ld = new Litedirecte();
await ld.auth.login("your_username", "your_password");

// 1. Fetch available quizzes
const result = await ld.qcms.getQcms();
const activeQuiz = result.associations?.[0];

if (activeQuiz) {
  console.log(`Let's work on: ${activeQuiz.titre || "Untitled Quiz"}`);

  // 2. Fetch questions for this quiz
  const details = await ld.qcms.getQcmDetail(activeQuiz.idQcm, activeQuiz.id);

  details.questions.forEach((question, index) => {
    console.log(`Question ${index + 1}: ${question.libelle}`);
    question.choices.forEach(choice => {
      console.log(`  [ ] ID: ${choice.id} | ${choice.libelle}`);
    });
  });
} else {
  console.log("No quizzes assigned right now!");
}
```

---

## 📖 API Reference

### `ld.qcms.getQcms`

Retrieves a list of all assigned questionnaires/QCMs.

```typescript
ld.qcms.getQcms(): Promise<any>
```

---

### `ld.qcms.getQcmDetail`

Retrieves the question set and candidate choices for a specific QCM.

```typescript
ld.qcms.getQcmDetail(
  idQcm: number,
  idAssociation: number,
): Promise<any>
```

---

### `ld.qcms.updateQcmStatus`

Updates the student's status on a quiz (e.g., when they start or complete it).

```typescript
ld.qcms.updateQcmStatus(
  idQcm: number,
  idAssociation: number,
  idParticipant: number,
  action: "updateStartDate" | "updateEndDate",
): Promise<{ success: boolean }>
```

- `idParticipant`: Participant ID returned in the QCM details.
- `action`: Use `"updateStartDate"` when the student opens/starts the test, and `"updateEndDate"` when finalizing and submitting the complete exam.

---

### `ld.qcms.submitQcmAnswer`

Submits selected choice IDs for a single question.

```typescript
ld.qcms.submitQcmAnswer(
  params: {
    idQcm: number;
    idAssociation: number;
    idParticipant: number;
    idReponse: number;
    idQuestion: number;
    choiceIds: number[];
  },
): Promise<{ success: boolean }>
```

- `choiceIds`: An array of numeric choice IDs the student selected for this question.

All ids (`idQcm`, `idAssociation`, `idParticipant`, `idReponse`, `idQuestion`) must be positive integers, otherwise an `EdValidationError` is thrown and nothing is requested.

---

## 🗂️ Response Shape

`ld.qcms.getQcms` and `ld.qcms.getQcmDetail` resolve to the raw EcoleDirecte API payload (treated as `any`). Litedirecte preserves the API's original key names and only normalizes values (date strings become `Date`, base64 fields are decoded).

---

## 💾 Caching

`getQcms()` (the list) is maintained; `getQcmDetail(idQcm, idAssociation)` is a manual entry. Every read accepts `{ force: true }` to skip the cache. See [Cache & sync](Cache.md).
