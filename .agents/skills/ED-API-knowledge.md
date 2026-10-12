---
name: ecoledirecte-api-knowledge
description: Reference documentation on how the (unofficial) EcoleDirecte API works — authentication, endpoints, request/response formats. Always use this skill whenever the user mentions EcoleDirecte, ED, "cahier de textes", "carnet de notes", "vie scolaire", or asks to write/debug code that calls the EcoleDirecte API, even if the word "API" isn't explicitly said.
---

# EcoleDirecte API Knowledge

The full documentation for EcoleDirecte's unofficial API lives at this address:

**https://docsdirecte.scolup.qzz.io**

## Workflow

1. Before writing or debugging any code that calls the EcoleDirecte API, fetch the content at the URL above.
2. Base all the code (authentication, endpoints, request/response formats) on what that page returns — not on assumptions or general memory of similar school APIs. EcoleDirecte has quirks that break those assumptions.
3. If the fetch fails (page unreachable, no network access, 404, empty content): say so clearly to the user instead of inventing plausible API behavior. Never hallucinate an endpoint or a token format for lack of documentation.
4. If the fetched content seems outdated or incomplete compared to what's observed in practice, flag it to the user rather than silently forcing a workaround.

## Security

- Treat EcoleDirecte session tokens as sensitive secrets (they grant access to minors' school data): never log them in plaintext, never commit them to a repo.
- Never hard-code credentials or tokens in example code or code delivered to the user.
- Confirm with the user before writing code that would automate bulk actions (pulling data for multiple accounts, repeated scraping).
