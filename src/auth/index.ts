// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import { assertAlive, getConfig, setConfig, setToken, type EdContext } from '../core/context';
import {
  clearSession as clearSessionState,
  loadSession as loadSessionState,
  switchAccount as switchAccountState,
} from '../core/store';
import {
  buildApiUrl,
  buildRequestBody,
  buildHeaders,
  sendRequest,
  parseJsonResponse,
} from '../core/http';
import {
  EdAuthError,
  EdNetworkError,
  EdValidationError,
  getFriendlyErrorMessage,
} from '../core/errors';
import { assertNonEmptyString } from '../core/validate';
import { randomUUID } from '../core/env';
import {
  LoginResult,
  LoginSuccess,
  LoginChallenge,
  Account,
  StorageAdapter,
  EdConfig,
  Resource,
} from '../types';
import { transform, safeDecodeBase64 } from '../core/transform';
import {
  checkTokenHealth as checkHealth,
  startTokenKeepalive as startKeepalive,
  stopTokenKeepalive as stopKeepalive,
} from '../core/health';
import { ensureOnlineFlushListener, flushQueue } from '../core/queue';
import { recordRateHit } from '../core/fetch';

export interface LoginOptions {
  rememberMe?: boolean;
  on2faRequired?: (
    question: string,
    choices: string[],
  ) => number | string | Promise<number | string>;
  storage?: StorageAdapter;
  passkey?: string;
  /** Resources skipped by the background prefetch after login. Defaults to `fetchIgnore`. */
  ignore?: Resource[];
  /** @internal: refresh-internal logins never prefetch. */
  __internal?: boolean;
  /** @internal: background logins never prompt for 2FA. */
  __interactive?: boolean;
}

/**
 * Authentication namespace: login, session persistence, token refresh and keepalive.
 *
 * @example
 * ```ts
 * const ld = new Litedirecte({ storage });
 * await ld.auth.login('john.doe', 'secret');
 * ```
 */
export class AuthNamespace {
  constructor(private ctx: EdContext) {}

  /**
   * Log in with username and password.
   *
   * @example
   * ```ts
   * await ld.auth.login('john.doe', 'secret', { rememberMe: true });
   * ```
   */
  login = (username: string, password: string, options: LoginOptions = {}): Promise<LoginResult> =>
    login(this.ctx, username, password, options);

  /**
   * Log out: stop keepalive, clear session state, queue and storage keys.
   *
   * @example
   * ```ts
   * await ld.auth.logout();
   * ```
   */
  logout = (): Promise<void> => logout(this.ctx);

  /**
   * Refresh the session token (used automatically on expiry).
   *
   * @example
   * ```ts
   * const token = await ld.auth.refreshToken();
   * ```
   */
  refreshToken = (): Promise<string> => refreshToken(this.ctx);

  /**
   * Load a persisted session from storage. Stays explicit: the constructor never calls it.
   *
   * @example
   * ```ts
   * const restored = await ld.auth.loadSession();
   * ```
   */
  loadSession = (): Promise<boolean> => loadSession(this.ctx);

  /**
   * Clear persisted and in-memory session state.
   *
   * @example
   * ```ts
   * await ld.auth.clearSession();
   * ```
   */
  clearSession = (): Promise<void> => clearSessionState(this.ctx);

  /**
   * Currently selected account, if any.
   *
   * @example
   * ```ts
   * const account = ld.auth.getAccount();
   * ```
   */
  getAccount = (): Account | undefined => this.ctx.account;

  /**
   * All accounts from the last login.
   *
   * @example
   * ```ts
   * const accounts = ld.auth.getAccounts();
   * ```
   */
  getAccounts = (): Account[] => this.ctx.accounts ?? [];

  /**
   * Switch the current account and persist the session.
   *
   * @example
   * ```ts
   * await ld.auth.switchAccount(5555);
   * ```
   */
  switchAccount = (accountId: number): Promise<void> => switchAccountState(this.ctx, accountId);

  /**
   * When the token was last refreshed, if ever.
   *
   * @example
   * ```ts
   * const at = ld.auth.getLastTokenRefresh();
   * ```
   */
  getLastTokenRefresh = (): Date | undefined => this.ctx.lastTokenRefresh;

  /**
   * Ping the API to check whether the current token is still valid.
   *
   * @example
   * ```ts
   * const healthy = await ld.auth.checkTokenHealth();
   * ```
   */
  checkTokenHealth = (): Promise<boolean> => checkHealth(this.ctx);

  /**
   * Start the periodic token keepalive.
   *
   * @example
   * ```ts
   * ld.auth.startTokenKeepalive();
   * ```
   */
  startTokenKeepalive = (): void => startKeepalive(this.ctx);

  /**
   * Stop the periodic token keepalive.
   *
   * @example
   * ```ts
   * ld.auth.stopTokenKeepalive();
   * ```
   */
  stopTokenKeepalive = (): void => stopKeepalive(this.ctx);
}

export async function login(
  ctx: EdContext,
  username: string,
  password: string,
  options: LoginOptions = {},
): Promise<LoginResult> {
  assertAlive(ctx);
  if (typeof username === 'object' || typeof password === 'object') {
    throw new EdValidationError(
      'login(username, password, options?) only: the object form and the identifiant/identifier/motdepasse/password aliases were removed',
      'INVALID_ARGUMENT',
    );
  }
  assertNonEmptyString(username, 'username');
  assertNonEmptyString(password, 'password');

  const configUpdate: Partial<EdConfig> = {};
  if (options.storage !== undefined) configUpdate.storage = options.storage;
  if (options.passkey !== undefined) configUpdate.passkey = options.passkey;
  if (Object.keys(configUpdate).length > 0) setConfig(ctx, configUpdate);
  if (options.ignore !== undefined) {
    const { validateResourceList } = await import('../core/context');
    validateResourceList(options.ignore, 'ignore');
  }

  const gtk = await fetchGtkToken(ctx);
  let uuid = '';
  if (options.rememberMe) {
    const storage = getConfig(ctx).storage;
    const stored = await storage?.get(`ed_uuid_${username}`);
    if (stored) {
      uuid = stored;
    } else {
      uuid = randomUUID();
      await storage?.set(`ed_uuid_${username}`, uuid);
    }
  } else {
    uuid = randomUUID();
  }

  const {
    data: initRes,
    twofaToken,
    xToken,
  } = await sendAuthRequest(
    ctx,
    '/login.awp',
    {
      isReLogin: false,
      identifiant: username,
      motdepasse: password,
      sesouvenirdemoi: options.rememberMe ?? false,
      uuid,
      fa: [],
    },
    gtk,
  );

  if (initRes.code === 250) {
    return handleTwoFactor(ctx, username, password, uuid, options, gtk, twofaToken, xToken);
  }

  if (initRes.code === 202) {
    const rawMsg =
      initRes.message || 'First login required: password/identifiers not yet customized';
    const friendlyMsg = getFriendlyErrorMessage('202', rawMsg);
    throw new EdAuthError(friendlyMsg, 'FIRST_LOGIN', undefined, initRes);
  }

  if (initRes.code === 240) {
    const rawMsg = initRes.message || "Charte d'utilisation must be accepted";
    const friendlyMsg = getFriendlyErrorMessage('240', rawMsg);
    throw new EdAuthError(friendlyMsg, 'CHARTE_REQUIRED', undefined, initRes);
  }

  if (initRes.code !== 200) {
    const rawMsg = initRes.message || 'Login failed';
    const friendlyMsg = getFriendlyErrorMessage(String(initRes.code), rawMsg);
    throw new EdAuthError(friendlyMsg, String(initRes.code), undefined, initRes);
  }

  if (xToken) setToken(ctx, xToken);
  if (twofaToken) ctx.twofaToken = twofaToken;

  const prevAccountId = ctx.account?.id;
  const success = await handleLoginSuccess(ctx, initRes, uuid, options);
  if (prevAccountId !== undefined && prevAccountId !== success.user.id) {
    ctx.sessionGen++;
  }
  await persistSession(ctx);
  startKeepalive(ctx);
  flushOfflineQueue(ctx);
  try {
    const { clearAuthPause, setSyncState } = await import('../core/sync');
    clearAuthPause(ctx);
    setSyncState(ctx, 'idle');
  } catch {}
  if (!options.__internal) {
    try {
      (ctx as EdContext & { prefetchHook?: (ignore?: Resource[]) => void }).prefetchHook?.(
        options.ignore,
      );
    } catch {}
  }
  return success;
}

async function persistSession(ctx: EdContext): Promise<void> {
  const { persistSession: persist } = await import('../core/store');
  await persist(ctx);
}

async function sendAuthRequest(
  ctx: EdContext,
  endpoint: string,
  body: Record<string, unknown>,
  gtk: string,
  twofaToken?: string,
  xToken?: string,
): Promise<{ data: any; twofaToken: string; xToken: string }> {
  const headers: Record<string, string> = {
    ...buildHeaders(ctx, { skipAuth: true, useGtk: gtk }),
  };
  if (twofaToken) headers['2FA-Token'] = twofaToken;
  if (xToken) headers['X-Token'] = xToken;

  const response = await sendRequest({
    url: buildApiUrl(ctx, endpoint).toString(),
    method: 'POST',
    headers,
    body: buildRequestBody(endpoint, body),
    timeoutMs: getConfig(ctx).timeout,
  });
  recordRateHit(ctx);

  const data = await parseJsonResponse(response);
  return {
    data,
    twofaToken: response.headers.get('2fa-token') || '',
    xToken: response.headers.get('x-token') || '',
  };
}

async function fetchGtkToken(ctx: EdContext): Promise<string> {
  const response = await sendRequest({
    url: buildApiUrl(ctx, '/login.awp?gtk=1').toString(),
    method: 'GET',
    headers: buildHeaders(ctx, { skipAuth: true }),
    timeoutMs: getConfig(ctx).timeout,
  });
  recordRateHit(ctx);
  const cookies = response.headers.get('set-cookie') || '';
  const match = cookies.match(/GTK=([^;]+)/);
  return match ? match[1] : '';
}

async function handleTwoFactor(
  ctx: EdContext,
  identifiant: string,
  motdepasse: string,
  uuid: string,
  options: LoginOptions,
  gtk: string,
  twofaToken: string,
  xToken: string,
): Promise<LoginChallenge | LoginSuccess> {
  const {
    data: challenge,
    twofaToken: t3,
    xToken: x3,
  } = await sendAuthRequest(
    ctx,
    '/connexion/doubleauth.awp?verbe=get',
    {},
    gtk,
    twofaToken,
    xToken,
  );

  if (challenge.code !== 200) {
    const rawMsg = challenge.message || '2FA challenge request failed';
    const friendlyMsg = getFriendlyErrorMessage(String(challenge.code), rawMsg);
    throw new EdAuthError(friendlyMsg, String(challenge.code), undefined, challenge);
  }

  const question = safeDecodeBase64(challenge.data.question);
  const choices = challenge.data.propositions.map(safeDecodeBase64);

  const answer = async (choice: number | string): Promise<LoginSuccess> => {
    assertAlive(ctx);
    let index = -1;
    if (typeof choice === 'number') {
      index = choice;
    } else {
      index = choices.indexOf(choice);
      if (index === -1) {
        const lower = choice.toLowerCase();
        index = choices.findIndex((c: string) => c.toLowerCase() === lower);
      }
    }

    if (index === -1 || index >= challenge.data.propositions.length) {
      throw new EdAuthError(
        `Invalid 2FA choice: "${choice}". Must be a valid index (0 to ${choices.length - 1}) or one of the valid options: [${choices.join(', ')}].`,
        'INVALID_2FA_CHOICE',
      );
    }

    const selected = challenge.data.propositions[index];
    const {
      data: validate,
      twofaToken: t4,
      xToken: x4,
    } = await sendAuthRequest(
      ctx,
      '/connexion/doubleauth.awp?verbe=post',
      { choix: selected },
      gtk,
      t3,
      x3,
    );

    if (validate.code !== 200) {
      const rawMsg = validate.message || '2FA validation failed';
      const friendlyMsg = getFriendlyErrorMessage(String(validate.code), rawMsg);
      throw new EdAuthError(friendlyMsg, String(validate.code), undefined, validate);
    }

    const { cn, cv } = validate.data;
    const {
      data: finalRes,
      twofaToken: t5,
      xToken: x5,
    } = await sendAuthRequest(
      ctx,
      '/login.awp',
      {
        isReLogin: false,
        identifiant,
        motdepasse,
        sesouvenirdemoi: options.rememberMe ?? false,
        cn,
        cv,
        uuid,
        fa: [],
      },
      gtk,
      t4,
      x4,
    );

    if (finalRes.code === 202) {
      const rawMsg =
        finalRes.message || 'First login required: password/identifiers not yet customized';
      const friendlyMsg = getFriendlyErrorMessage('202', rawMsg);
      throw new EdAuthError(friendlyMsg, 'FIRST_LOGIN', undefined, finalRes);
    }

    if (finalRes.code === 240) {
      const rawMsg = finalRes.message || "Charte d'utilisation must be accepted";
      const friendlyMsg = getFriendlyErrorMessage('240', rawMsg);
      throw new EdAuthError(friendlyMsg, 'CHARTE_REQUIRED', undefined, finalRes);
    }

    if (finalRes.code !== 200) {
      const rawMsg = finalRes.message || 'Login failed';
      const friendlyMsg = getFriendlyErrorMessage(String(finalRes.code), rawMsg);
      throw new EdAuthError(friendlyMsg, String(finalRes.code), undefined, finalRes);
    }

    if (x5) setToken(ctx, x5);
    if (t5) ctx.twofaToken = t5;

    const prevAccountId = ctx.account?.id;
    const success = await handleLoginSuccess(ctx, finalRes, uuid, options);
    if (prevAccountId !== undefined && prevAccountId !== success.user.id) {
      ctx.sessionGen++;
    }
    await persistSession(ctx);
    startKeepalive(ctx);
    flushOfflineQueue(ctx);
    try {
      const { clearAuthPause, setSyncState } = await import('../core/sync');
      clearAuthPause(ctx);
      setSyncState(ctx, 'idle');
    } catch {}
    if (!options.__internal) {
      try {
        (ctx as EdContext & { prefetchHook?: (ignore?: Resource[]) => void }).prefetchHook?.(
          options.ignore,
        );
      } catch {}
    }
    return success;
  };

  const interactive = options.__interactive !== false;
  const on2fa = interactive ? options.on2faRequired || getConfig(ctx).on2faRequired : undefined;
  if (on2fa) {
    const choice = await on2fa(question, choices);
    return answer(choice);
  }

  return { type: 'securityQuestion', question, choices, answer };
}

async function handleLoginSuccess(
  ctx: EdContext,
  result: any,
  uuid: string,
  options: LoginOptions,
): Promise<LoginSuccess> {
  const transformed = transform(result.data);
  const accounts = transformed?.accounts as Account[] | undefined;
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new EdAuthError('No account returned', 'NO_ACCOUNT');
  }
  const main = accounts.find((a) => a.main) || accounts[0];
  if (!main) {
    throw new EdAuthError('No account returned', 'NO_ACCOUNT');
  }
  ctx.account = main;
  ctx.accounts = accounts;

  if (options.rememberMe) {
    const storage = getConfig(ctx).storage;
    if (storage && main.accessToken) {
      await storage.set(`ed_access_token_${main.id}`, main.accessToken);
      if (uuid) {
        await storage.set(`ed_uuid_${main.id}`, uuid);
      }
    }
  }

  return {
    type: 'success',
    user: main,
    token: result.token || ctx.token || '',
    sessionId: main.uid,
  };
}

export async function logout(ctx: EdContext): Promise<void> {
  assertAlive(ctx);
  stopKeepalive(ctx);
  await clearSessionState(ctx);
}

/** Fire-and-forget queue flush after a successful login; never throws. */
function flushOfflineQueue(ctx: EdContext): void {
  try {
    if (!getConfig(ctx).offlineQueue) return;
    ensureOnlineFlushListener(ctx);
    void flushQueue(ctx).catch(() => {});
  } catch {}
}

export async function loadSession(ctx: EdContext): Promise<boolean> {
  assertAlive(ctx);
  const loaded = await loadSessionState(ctx);
  if (loaded) {
    startKeepalive(ctx);
    try {
      const { setSyncState } = await import('../core/sync');
      setSyncState(ctx, 'idle');
    } catch {}
    try {
      if (getConfig(ctx).offlineQueue) {
        ensureOnlineFlushListener(ctx);
        void flushQueue(ctx).catch(() => {});
      }
    } catch {}
  }
  return loaded;
}

export async function refreshToken(
  ctx: EdContext,
  opts: { interactive?: boolean } = {},
): Promise<string> {
  assertAlive(ctx);
  const interactive = opts.interactive !== false;
  let account = ctx.account;
  if (!account) {
    await loadSessionState(ctx);
    account = ctx.account;
    if (!account) {
      throw new EdAuthError('No account found for refresh', 'NO_ACCOUNT');
    }
  }

  const config = getConfig(ctx);
  const storage = config.storage;
  const accessToken = await storage?.get(`ed_access_token_${account.id}`);
  const uuid = await storage?.get(`ed_uuid_${account.id}`);

  let refreshError: any = null;

  if (accessToken) {
    try {
      const gtk = await fetchGtkToken(ctx);
      const { data, xToken, twofaToken } = await sendAuthRequest(
        ctx,
        '/login.awp',
        {
          identifiant: account.identifiant,
          isReLogin: true,
          motdepasse: '???',
          accesstoken: accessToken,
          typeCompte: account.typeCompte,
          uuid: uuid || '',
        },
        gtk,
        ctx.twofaToken,
        ctx.token,
      );

      if (data.code !== 200) {
        const rawMsg = data.message || 'Refresh failed';
        const friendlyMsg = getFriendlyErrorMessage(String(data.code), rawMsg);
        throw new EdAuthError(friendlyMsg, String(data.code), undefined, data);
      }

      if (xToken) setToken(ctx, xToken);
      if (twofaToken) ctx.twofaToken = twofaToken;

      startKeepalive(ctx);
      try {
        const { clearAuthPause } = await import('../core/sync');
        clearAuthPause(ctx);
      } catch {}
      return xToken || data.token || '';
    } catch (error) {
      if (error instanceof EdNetworkError) throw error;
      refreshError = error;
      try {
        await config.onError?.(error);
      } catch {}
    }
  }

  if (!interactive) {
    if (refreshError) throw refreshError;
    throw new EdAuthError('Refresh failed', 'REFRESH_FAILED');
  }

  if (config.onCredentialsRequired) {
    try {
      const { identifiant, motdepasse } = await config.onCredentialsRequired();
      const res = await login(ctx, identifiant, motdepasse, {
        rememberMe: true,
        __internal: true,
        __interactive: true,
      });
      if ('token' in res) {
        try {
          const { clearAuthPause } = await import('../core/sync');
          clearAuthPause(ctx);
        } catch {}
        return res.token;
      }
    } catch (err) {
      if (refreshError) throw refreshError;
      throw err;
    }
  }

  if (refreshError) {
    throw refreshError;
  }

  throw new EdAuthError('Refresh failed', 'REFRESH_FAILED');
}
