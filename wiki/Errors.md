<p align="center">
  <picture><source media="(prefers-color-scheme: light)" srcset="https://shieldcn.dev/header/glow.svg?title=Errors&amp;subtitle=Learn+how+to+handle+exceptions+in+Litedirecte.&amp;logo=lu%3ACircleX&amp;mode=light&amp;theme=blue&amp;align=left" /><img alt="Errors | Learn how to handle exceptions in Litedirecte." src="https://shieldcn.dev/header/glow.svg?title=Errors&amp;subtitle=Learn+how+to+handle+exceptions+in+Litedirecte.&amp;logo=lu%3AAlertTriangle&amp;mode=dark&amp;theme=blue&amp;align=left" /></picture>
</p>

Litedirecte provides a comprehensive, granular, and type-safe error taxonomy designed to make debugging simple. All custom errors inherit from the base class `EdError`, ensuring that you can catch all SDK-related exceptions cleanly.

---

## 🏛️ Error Taxonomy

The SDK implements the following hierarchical error classes:

- **`EdError`**: The base error class. Every exception thrown by Litedirecte is an instance of `EdError`.
  - **`EdAuthError`**: Thrown during login, 2FA validation, or session refresh failures.
  - **`EdApiError`**: Thrown when EcoleDirecte returns an error code or an unexpected response status.
    - **`EdValidationError`**: Thrown during client-side argument and option validation (e.g., passing empty parameters, invalid bounds).
  - **`EdNetworkError`**: Thrown when physical connection issues occur.
    - **`EdOfflineError`**: Thrown when a read would need the network while offline (see `isOnline`): a read with nothing cached, or any `{ force: true }` read. A read served from the cache does not throw — it reports the same error through `ld.sync.getState().lastError`. Never retried, no backoff. Mutations still go through the offline queue as usual.
    - **`EdServerError`**: Thrown when EcoleDirecte returns an HTTP status code indicating a server-side error (HTTP >= 500).
      - **`EdParseError`**: Thrown when the SDK fails to parse an EcoleDirecte response payload as JSON.
    - **`EdTimeoutError`**: Thrown when an API request times out.
  - **`EdRateLimitError`**: Thrown when the user exceeds request rate limits (HTTP 429). Carries `retryAfterMs` when the server sent a `Retry-After` header.
  - **`EdUnsupportedModuleError`**: Thrown (before any network request, and never retried) when the current account lacks the EcoleDirecte module a namespace needs. Carries the `module` code (e.g. `"NOTES"`).
  - **`EdTransformError`**: Reserved for internal transformation and Base64 decoding issues. It is exported for `instanceof` checks, but the current implementation never throws it: the transform layer is total, so a field that is not decodable Base64 is passed through **unchanged** instead of raising.

### Error Codes

Every `EdError` carries a `code`. Some are raised by the SDK itself, others pass through the raw numeric API code.

**Raised by the SDK**

| Code | Class | Meaning |
| :--- | :--- | :--- |
| `INVALID_ARGUMENT` | `EdValidationError` | Client-side validation failed: an empty string/array, a non-positive id, an out-of-range number, or an unparseable date. Thrown before any network request. |
| `INVALID_2FA_CHOICE` | `EdAuthError` | `submit2FA` was given a choice that is neither a valid index nor one of the returned options. The message lists the accepted values. |
| `UNSUPPORTED_MODULE` | `EdUnsupportedModuleError` | The current account lacks the module a namespace needs. Check `ld.supports()` / `ld.capabilities()` first. Inside `getAll` these land in `skipped`, not `errors`. |
| `NOT_LOGGED_IN` | `EdAuthError` | A read or `getAll` was called with no active session. Call `login()` first. |
| `NO_ACCOUNT` | `EdAuthError` | `login` answered `200` without usable accounts, or no account was available for a token refresh. |
| `SESSION_ENDED` | `EdAuthError` | The session changed — logout, account switch, another login, `destroy` — while the request was in flight. Late responses are abandoned and never cached. |
| `2FA_REQUIRED` | `EdAuthError` | An API code `250` arrived on a normal request. Only the login/2FA flows treat `250` as success. |
| `REFRESH_FAILED` | `EdAuthError` | The background token refresh could not produce a usable token. The next foreground request retries interactively. |
| `OFFLINE` | `EdOfflineError` | A read needed the network while offline: nothing cached for that key, or any `{ force: true }` read. Never retried, no backoff. A read served from cache does **not** throw — it reports this same error via `ld.sync.getState().lastError`. Mutations still enter the offline queue. |
| `UNSUPPORTED_ENVIRONMENT` | `EdValidationError` | A storage adapter was requested on a runtime that cannot provide it (e.g. `localStorage` in a worker with no DOM). |
| `UNKNOWN` | `EdError` | Polling caught something that was not an `EdError` (a raw thrown value). It is wrapped so the `pollingError` payload keeps its documented type, and the original value becomes the message. |
| `STORAGE_DECRYPT_FAILED` | `EdValidationError` / `EdError` | An encrypted-storage value could not be decrypted, usually a wrong `passkey`. Inside a storage adapter this never rejects: the read resolves `null` and the error is reported **once per key** through `config.onError`. The standalone `decrypt()` helper throws it directly. |

**Transport and protocol** — these codes always come with a `statusCode` where one applies.

| Code | Class | Meaning |
| :--- | :--- | :--- |
| `NETWORK_ERROR` | `EdNetworkError` | The request never reached the server (DNS failure, connection refused, CORS rejection). Carries the original error in `raw`. |
| `TIMEOUT_ERROR` | `EdTimeoutError` | The request exceeded the configured `timeout`. |
| `RATE_LIMIT` | `EdRateLimitError` | HTTP 429. Carries `retryAfterMs` when the server sent a `Retry-After` header; reads back off automatically. |
| `SERVER_ERROR` | `EdServerError` | HTTP >= 500. |
| `PARSE_ERROR` | `EdParseError` | The response body was not valid JSON. The raw text is kept in `raw`. |
| `INVALID_RESPONSE` | `EdValidationError` | The response parsed but did not carry the expected shape (e.g. a null body when streaming a download). |

**Passed through from the API** — when EcoleDirecte answers with a numeric code the SDK does not recognise, `error.code` is that number as a string (e.g. `"505"`). See [Raw API Code Mapping](#️-raw-api-code-mapping) for the codes with friendly messages.

---

## 🗂️ Error Properties

All errors produced by the SDK feature standard properties:

| Property | Type | Description |
| :--- | :--- | :--- |
| `name` | `string` | The exact class name of the error (e.g., `"EdTimeoutError"`). Preserved from minification. |
| `message` | `string` | Human-readable message, formatted with the code prefix and status suffix. |
| `code` | `string` | A unique string/integer identifier (e.g., `"TIMEOUT_ERROR"`, `"505"`, `"INVALID_ARGUMENT"`). |
| `statusCode` | `number \| undefined` | The associated HTTP status code, if applicable. |
| `raw` | `unknown \| undefined` | The raw API response payload or original exception source. (Omitted from default `toJSON()` serialization). |
| `stack` | `string \| undefined` | Optional, non-standard error stack trace. |

---

## 📝 Usage & Catching Examples

### Catching Specific Errors

You can use standard JavaScript/TypeScript `instanceof` checks to handle errors dynamically:

```typescript
import { Litedirecte, EdTimeoutError, EdAuthError, EdError } from "litedirecte";

const ld = new Litedirecte();
await ld.auth.loadSession().catch(() => null);

try {
  await ld.auth.login("my_username", "my_password");
  const grades = await ld.grades.getGrades();
} catch (error) {
  if (error instanceof EdAuthError) {
    console.error("Authentication issue:", error.message);
  } else if (error instanceof EdTimeoutError) {
    console.warn("The server took too long to respond. Retrying...");
  } else if (error instanceof EdError) {
    console.error(`SDK Error [${error.code}]:`, error.message);
  } else {
    console.error("Unknown error:", error);
  }
}
```

### Serializing to JSON

The `toJSON()` helper on `EdError` is extremely helpful when logging to external telemetry, monitoring tools, or serializing logs:

```typescript
import { Litedirecte, EdError } from "litedirecte";

const ld = new Litedirecte();
await ld.auth.login("my_username", "my_password");

try {
  await ld.grades.getGrades();
} catch (error) {
  if (error instanceof EdError) {
    console.log(JSON.stringify(error.toJSON(), null, 2));
  }
}
```

**JSON Output Example:**
```json
{
  "name": "EdTimeoutError",
  "message": "[TIMEOUT_ERROR] Request to https://api.ecoledirecte.com/v3/notes.awp?v=8.1.0 timed out after 15000ms",
  "code": "TIMEOUT_ERROR",
  "statusCode": 0,
  "stack": "EdTimeoutError: [TIMEOUT_ERROR] Request to... at sendRequest ..."
}
```

---

## 🗺️ Raw API Code Mapping

EcoleDirecte API relies on numeric response codes. The SDK automatically maps these cryptic response codes into descriptive, friendly error messages to save you time:

| Raw Code | Status | Friendly Description mapped by SDK |
| :--- | :--- | :--- |
| `250` | Double Auth Required | Two-factor authentication required |
| `505` | Invalid Credentials | Invalid username or password |
| `520` | Token Invalid | Session expired: Invalid session token |
| `521` | Re-login Required | Session expired: Re-login required |
| `522` | Bad Signature | Invalid headers or signature |
| `525` | Missing/Invalid Token | Session expired: Token is missing or invalid |
