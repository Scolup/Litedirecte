<p align="center">
  <picture><source media="(prefers-color-scheme: light)" srcset="https://shieldcn.dev/header/glow.svg?title=Contribute+to+Litedirecte&amp;subtitle=It%27s+also+thanks+to+you+if+Litedirecte+exists+today%21&amp;logo=lu%3AHandshake&amp;mode=light&amp;theme=blue&amp;align=left" /><img alt="Contribute to Litedirecte | It's also thanks to you if Litedirecte exists today!" src="https://shieldcn.dev/header/glow.svg?title=Contribute+to+Litedirecte&amp;subtitle=It%27s+also+thanks+to+you+if+Litedirecte+exists+today%21&amp;logo=lu%3AHandshake&amp;mode=dark&amp;theme=blue&amp;align=left" /></picture>
</p>

## 🚀 Getting started

For development, **Bun is required**.

1. 🧑‍🤝‍🧑 Clone the repo
```bash
gh repo clone Scolup/Litedirecte
```
2. ⬇️ Install deps
```bash
bun install
```
3. ⛏️ Start working!

## 🗂️ Project structure

```
src/
├── auth/       # Login, token management, 2FA
├── core/       # Shared HTTP client, session handling
├── modules/    # API endpoints (grades, absences, etc.)
└── types/      # TypeScript type definitions
tests/          # Bun test files
wiki/           # Documentation (auto-published to gh wiki on push)
```

## 🧪 Running tests

```bash
bun test
```

Tests live in `tests/` and use Bun's built-in test runner. If you're adding a new feature or fixing a bug, add or update tests where relevant.

## 📏 Rules

* At every production commit (this means before a PR is merged or in a commit directly pushed to main), **run `bun precommit`**. This will run checks and format with oxfmt.
* When making a commit, follow [conventional commits](https://www.conventionalcommits.org/en/v1.0.0/). When making a new branch, follow [conventional branch](https://conventionalbranch.org).
* If you're working on a big or breaking change, discuss it in an issue with the admins before opening a PR, and link that issue in your PR.
* To work on Litedirecte, _fork the project_ and target your PR to either `main` or another official branch.
* Versioning is managed only by the project admins. Please do not change it directly.
* **NEVER** manually publish to npm (except if the GitHub workflow doesn't work and the release can't wait to be published).
* Update the docs in the [wiki](wiki/) folder if needed.

## 🤖 Developing with AI

Working with AI is something we **totally accept**, but to these conditions :
* You are honest and *do not* lie when we ask if your work has been partially or fully vibe-coded
* You are **capable of explaining your changes**

We already wrote resources specifically for agents so they understand the codebase and know how to work with it.

---

<p align="center">
  <a href="https://github.com/Scolup/Litedirecte/graphs/contributors"><picture><source media="(prefers-color-scheme: light)" srcset="https://shieldcn.dev/contributors/Scolup/Litedirecte.svg?preset=glow&amp;theme=blue&amp;size=80&amp;names=true&amp;align=left&amp;mode=light" /><img alt="Project contributors" src="https://shieldcn.dev/contributors/Scolup/Litedirecte.svg?preset=glow&amp;theme=blue&amp;size=80&amp;names=true&amp;align=left&amp;mode=dark" /></picture></a>
</p>
