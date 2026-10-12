// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
export class EdError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode?: number,
    public raw?: unknown,
  ) {
    const codePrefix = code ? `[${code}] ` : '';
    const statusSuffix = statusCode ? ` (HTTP ${statusCode})` : '';
    super(`${codePrefix}${message}${statusSuffix}`);
    this.name = 'EdError';
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      stack: this.stack,
    };
  }
}

export class EdAuthError extends EdError {
  name = 'EdAuthError';
}

export class EdNetworkError extends EdError {
  name = 'EdNetworkError';
}

export class EdRateLimitError extends EdError {
  name = 'EdRateLimitError';
  retryAfterMs?: number;
  constructor(
    message: string,
    code: string,
    statusCode?: number,
    raw?: unknown,
    retryAfterMs?: number,
  ) {
    super(message, code, statusCode, raw);
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs;
  }
}

export class EdApiError extends EdError {
  name = 'EdApiError';
}

export class EdTransformError extends EdError {
  name = 'EdTransformError';
}

export class EdValidationError extends EdApiError {
  name = 'EdValidationError';
}

export class EdServerError extends EdNetworkError {
  name = 'EdServerError';
}

export class EdParseError extends EdServerError {
  name = 'EdParseError';
}

export class EdTimeoutError extends EdNetworkError {
  name = 'EdTimeoutError';
}

/** Thrown when a read would need the network while offline. Never retried. */
export class EdOfflineError extends EdNetworkError {
  name = 'EdOfflineError';
}

/** Thrown when the current account does not have the EcoleDirecte module a call needs. Never retried. */
export class EdUnsupportedModuleError extends EdError {
  name = 'EdUnsupportedModuleError';
  constructor(
    message: string,
    public module: string,
    statusCode?: number,
    raw?: unknown,
  ) {
    super(message, 'UNSUPPORTED_MODULE', statusCode, raw);
  }
}

export const ED_CODE_MESSAGES: Record<string, string> = {
  '250': 'Two-factor authentication required',
  '505': 'Invalid username or password',
  '520': 'Session expired: Invalid session token',
  '521': 'Session expired: Re-login required',
  '522': 'Invalid headers or signature',
  '525': 'Session expired: Token is missing or invalid',
};

export function getFriendlyErrorMessage(code: string, defaultMessage: string): string {
  return ED_CODE_MESSAGES[code] || defaultMessage;
}
