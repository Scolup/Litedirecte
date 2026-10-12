// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import { EdUnsupportedModuleError } from './errors';
import { type EdContext } from './context';

/**
 * Friendly names mapped to the verified EcoleDirecte module codes.
 * Verified against BlocksDirecte's client (which passes these codes as
 * `moduleName`) and this repo's mock account (`NOTES`):
 * timetable → `EDT`, marks → `NOTES`, homework → `CAHIER_DE_TEXTES`,
 * schoollife → `VIE_SCOLAIRE`.
 */
export const ED_MODULES = {
  grades: 'NOTES',
  timetable: 'EDT',
  homework: 'CAHIER_DE_TEXTES',
  attendance: 'VIE_SCOLAIRE',
} as const;

export type ModuleKey = keyof typeof ED_MODULES;

/** Throw unless the current account has the module (code present and `enable` truthy). */
export function requireModule(ctx: EdContext, key: ModuleKey, mockMode?: boolean): void {
  if (mockMode) return;
  const account = ctx.account;
  const modules = account?.modules;
  if (!modules || modules.length === 0) return;
  const code = ED_MODULES[key];
  const found = modules.find((m) => m.code === code);
  if (!found || !found.enable) {
    throw new EdUnsupportedModuleError(
      `The current account does not support the "${code}" module required for "${key}"`,
      code,
    );
  }
}

/** Whether the current account supports a namespace (`true` for unchecked namespaces and unknown modules). */
export function supports(ctx: EdContext, key: string): boolean {
  if (!(key in ED_MODULES)) return true;
  const account = ctx.account;
  const modules = account?.modules;
  if (!modules || modules.length === 0) return true;
  const code = ED_MODULES[key as ModuleKey];
  const found = modules.find((m) => m.code === code);
  if (!found) return false;
  return Boolean(found.enable);
}

/** Support map for every checked namespace. Follows `switchAccount`. */
export function capabilities(ctx: EdContext): Record<ModuleKey, boolean> {
  return {
    grades: supports(ctx, 'grades'),
    timetable: supports(ctx, 'timetable'),
    homework: supports(ctx, 'homework'),
    attendance: supports(ctx, 'attendance'),
  };
}
