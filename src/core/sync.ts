// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import { ctxNow } from './context';
import type { EdContext } from './context';

export type SyncStateName =
  | 'signed-out'
  | 'idle'
  | 'syncing'
  | 'offline'
  | 'error'
  | 'auth-required';

export interface SyncSnapshot {
  state: SyncStateName;
  lastSync: number | null;
  lastError: unknown;
}

function snapshot(ctx: EdContext): SyncSnapshot {
  return { ...ctx.syncState };
}

function notify(ctx: EdContext): void {
  const snap = snapshot(ctx);
  for (const cb of [...ctx.syncListeners]) {
    try {
      cb(snap as { state: string; lastSync: number | null; lastError: unknown });
    } catch {}
  }
}

export function setSyncState(
  ctx: EdContext,
  state: SyncStateName,
  lastError: unknown = null,
): void {
  if (ctx.destroyed) return;
  if (state === 'auth-required' && ctx.syncState.state === 'auth-required') return;
  ctx.syncState.state = state;
  ctx.syncState.lastError = lastError;
  if (state === 'idle') {
    ctx.syncState.lastSync = ctxNow(ctx);
  }
  notify(ctx);
}

export function setSyncAuthRequired(ctx: EdContext, error: unknown): void {
  if (ctx.destroyed) return;
  if (ctx.syncState.state === 'auth-required') return;
  ctx.authPaused = true;
  ctx.syncState.state = 'auth-required';
  ctx.syncState.lastError = error;
  notify(ctx);
}

export function clearAuthPause(ctx: EdContext): void {
  ctx.authPaused = false;
  if (ctx.syncState.state === 'auth-required') {
    ctx.syncState.state = ctx.account ? 'idle' : 'signed-out';
    ctx.syncState.lastError = null;
    notify(ctx);
  }
}

export function getSyncSnapshot(ctx: EdContext): SyncSnapshot {
  return snapshot(ctx);
}
