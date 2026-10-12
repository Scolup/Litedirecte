// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import { EdAuthError, EdValidationError } from './errors';
import { getConfig, type EdContext } from './context';

export async function switchAccount(ctx: EdContext, accountId: number): Promise<void> {
  if (!ctx.accounts) {
    throw new EdAuthError('No accounts available to switch', 'NOT_LOGGED_IN');
  }
  const found = ctx.accounts.find((acc) => acc.id === accountId);
  if (!found) {
    throw new EdValidationError(`Account with ID ${accountId} not found`, 'INVALID_ARGUMENT');
  }
  ctx.account = found;
  ctx.sessionGen++;
  await persistSession(ctx);
  try {
    (ctx as EdContext & { prefetchHook?: (ignore?: unknown) => void }).prefetchHook?.();
  } catch {}
}

const STORAGE_KEYS = {
  token: 'ed_tk',
  twofaToken: 'ed_tft',
  account: 'ed_acc',
  accounts: 'ed_accs',
  lastRefresh: 'ed_lr',
} as const;

export async function persistSession(ctx: EdContext): Promise<void> {
  const storage = getConfig(ctx).storage;
  if (!storage) return;

  const writes: [string, string][] = [];
  if (ctx.token) writes.push([STORAGE_KEYS.token, ctx.token]);
  if (ctx.twofaToken) writes.push([STORAGE_KEYS.twofaToken, ctx.twofaToken]);
  if (ctx.account) writes.push([STORAGE_KEYS.account, JSON.stringify(ctx.account)]);
  if (ctx.accounts) writes.push([STORAGE_KEYS.accounts, JSON.stringify(ctx.accounts)]);
  if (ctx.lastTokenRefresh)
    writes.push([STORAGE_KEYS.lastRefresh, ctx.lastTokenRefresh.toISOString()]);
  for (const [key, value] of writes) {
    try {
      await storage.set(key, value);
    } catch (error) {
      try {
        await getConfig(ctx).onError?.(error);
      } catch {}
    }
  }
}

export async function clearSession(ctx: EdContext): Promise<void> {
  const accounts = [...(ctx.accounts ?? [])];
  if (ctx.account && !accounts.some((a) => a.id === ctx.account!.id)) {
    accounts.push(ctx.account);
  }
  const extraKeys: string[] = [];
  for (const acc of accounts) {
    if (typeof acc.id === 'number') {
      extraKeys.push(`ed_access_token_${acc.id}`, `ed_uuid_${acc.id}`);
    }
    if (typeof acc.identifiant === 'string' && acc.identifiant) {
      extraKeys.push(`ed_uuid_${acc.identifiant}`);
    }
  }

  ctx.token = undefined;
  ctx.twofaToken = undefined;
  ctx.account = undefined;
  ctx.accounts = undefined;
  ctx.lastTokenRefresh = undefined;

  ctx.sessionGen++;
  ctx.queue.length = 0;
  ctx.queueFlushPromise = null;
  ctx.authPaused = false;

  const { purgeCacheStorage } = await import('./cache');
  await purgeCacheStorage(ctx);
  const { setSyncState } = await import('./sync');
  setSyncState(ctx, 'signed-out');

  const storage = getConfig(ctx).storage;
  if (!storage) return;

  const keys = [
    STORAGE_KEYS.token,
    STORAGE_KEYS.twofaToken,
    STORAGE_KEYS.account,
    STORAGE_KEYS.accounts,
    STORAGE_KEYS.lastRefresh,
    'ed_offline_queue',
    ...extraKeys,
  ];
  for (const key of keys) {
    try {
      await storage.delete(key);
    } catch {}
  }
}

export async function loadSession(ctx: EdContext): Promise<boolean> {
  const storage = getConfig(ctx).storage;
  if (!storage) return false;

  try {
    const [token, twofaToken, accountStr, accountsStr, lastRefreshStr] = await Promise.all([
      storage.get(STORAGE_KEYS.token),
      storage.get(STORAGE_KEYS.twofaToken),
      storage.get(STORAGE_KEYS.account),
      storage.get(STORAGE_KEYS.accounts),
      storage.get(STORAGE_KEYS.lastRefresh),
    ]);

    let loaded = false;
    if (token) {
      ctx.token = token;
      loaded = true;
    }
    if (twofaToken) ctx.twofaToken = twofaToken;
    if (accountStr) {
      try {
        ctx.account = JSON.parse(accountStr);
        loaded = true;
      } catch {}
    }
    if (accountsStr) {
      try {
        ctx.accounts = JSON.parse(accountsStr);
      } catch {}
    }
    if (lastRefreshStr) {
      const parsed = new Date(lastRefreshStr);
      if (!isNaN(parsed.getTime())) {
        ctx.lastTokenRefresh = parsed;
      }
    }

    return loaded;
  } catch {
    return false;
  }
}
