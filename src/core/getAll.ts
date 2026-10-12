// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import { ctxNow, validateResourceList } from './context';
import type { EdContext } from './context';
import { EdAuthError, EdUnsupportedModuleError, type EdError } from './errors';
import type { Resource } from '../types';
import { pruneDead } from './cache';
import { notLoggedInError, sessionEndedError } from './request';

export type { Resource };

export interface GetAllOptions {
  ignore?: Resource[];
}

export interface GetAllResult {
  errors: Partial<Record<Resource, EdError>>;
  skipped: Resource[];
  [key: string]: unknown;
}

export function validateIgnore(ignore: unknown): Resource[] {
  if (ignore === undefined) return [];
  validateResourceList(ignore, 'ignore');
  return [...(ignore as Resource[])];
}

/** Run per-resource jobs in parallel; one failure never rejects `getAll`. */
export async function collectGetAll(
  ctx: EdContext,
  ignore: Resource[],
  jobs: Record<Resource, () => Promise<unknown>>,
  setData: (out: Record<string, unknown>, resource: Resource, value: unknown) => void,
): Promise<GetAllResult> {
  const startGen = ctx.sessionGen;
  if (!ctx.account) {
    throw notLoggedInError();
  }
  const included = (Object.keys(jobs) as Resource[]).filter((r) => !ignore.includes(r));
  const out: Record<string, unknown> = {};
  const errors: Partial<Record<Resource, EdError>> = {};
  const skipped: Resource[] = [];
  const settled = await Promise.all(
    included.map(async (resource) => {
      try {
        const value = await jobs[resource]();
        return { resource, ok: true as const, value };
      } catch (error) {
        return { resource, ok: false as const, error };
      }
    }),
  );
  if (ctx.sessionGen !== startGen || ctx.destroyed) {
    throw sessionEndedError();
  }
  let authError: EdAuthError | null = null;
  let successCount = 0;
  for (const s of settled) {
    if (s.ok) {
      successCount++;
      setData(out, s.resource, s.value);
    } else if (s.error instanceof EdUnsupportedModuleError) {
      skipped.push(s.resource);
    } else {
      errors[s.resource] = s.error as EdError;
      if (s.error instanceof EdAuthError) authError = s.error;
    }
  }
  if (authError && successCount === 0 && skipped.length === 0 && Object.keys(errors).length > 0) {
    const allAuth = settled
      .filter((s) => !s.ok)
      .every((s) => (s as { error: unknown }).error instanceof EdAuthError);
    if (allAuth) throw authError;
  }
  for (const s of settled) {
    if (
      !s.ok &&
      s.error instanceof EdAuthError &&
      (s.error as EdAuthError).code === 'SESSION_ENDED'
    ) {
      throw s.error;
    }
  }
  void pruneDead(ctx);
  return { ...out, errors, skipped };
}

export function touchGetAllSuccess(ctx: EdContext): void {
  ctx.lastSuccessfulGetAllAt = ctxNow(ctx);
}
