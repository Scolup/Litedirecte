// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import { type EdContext } from './context';
import { EdAuthError } from './errors';
import type { Account } from '../types';
import type { FetchOptions } from './fetch';

export function notLoggedInError(): EdAuthError {
  return new EdAuthError(
    'Not logged in. Call login() before using account-specific features.',
    'NOT_LOGGED_IN',
  );
}

/** Thrown when the session changed (logout, account switch, destroy) mid-flight. */
export function sessionEndedError(): EdAuthError {
  return new EdAuthError('Session ended while the request was in flight', 'SESSION_ENDED');
}

export function requireCurrentAccount(ctx: EdContext): Account {
  const account = ctx.account;

  if (!account) {
    throw notLoggedInError();
  }

  return account;
}

export function postOptions<T extends FetchOptions = FetchOptions>(
  body: unknown,
  options: T = {} as T,
): T {
  return {
    method: 'POST',
    body,
    ...options,
  } as T;
}
