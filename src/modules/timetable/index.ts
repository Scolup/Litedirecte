// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import { edFetch } from '../../core/fetch';
import { postOptions, requireCurrentAccount } from '../../core/request';
import { requireModule } from '../../core/modules';
import { assertValidDate } from '../../core/validate';
import { EdValidationError } from '../../core/errors';
import type { EdContext } from '../../core/context';
import {
  isMondaySundayWeek,
  keyFor,
  neighbourWeeks,
  readResource,
  runAsBackground,
  writeEntry,
} from '../../core/cache';
import { ctxNow, isOnline } from '../../core/context';
import dayjs from 'dayjs';

export interface GetTimetableOptions {
  startDate?: string | Date;
  endDate?: string | Date;
  mockMode?: boolean;
  /** Skip the cache, fetch from the network, and write the result through. */
  force?: boolean;
}

export interface TimetableIcalUrlOptions {
  mockMode?: boolean;
}

/**
 * Timetable namespace (`EDT` module).
 *
 * @example
 * ```ts
 * const week = await ld.timetable.getTimetable();
 * ```
 */
export class TimetableNamespace {
  constructor(private ctx: EdContext) {}

  /**
   * Fetch timetable entries between two dates (defaults to today).
   *
   * @example
   * ```ts
   * const entries = await ld.timetable.getTimetable({ startDate: '2026-03-16', endDate: '2026-03-20' });
   * ```
   */
  getTimetable = async (options: GetTimetableOptions = {}): Promise<any> => {
    const account = requireCurrentAccount(this.ctx);
    requireModule(this.ctx, 'timetable', options.mockMode);
    if (options.startDate !== undefined) assertValidDate(options.startDate, 'startDate');
    if (options.endDate !== undefined) assertValidDate(options.endDate, 'endDate');
    if (options.startDate !== undefined && options.endDate !== undefined) {
      if (dayjs(options.endDate).isBefore(dayjs(options.startDate))) {
        throw new EdValidationError('endDate must not be before startDate', 'INVALID_ARGUMENT');
      }
    }
    const start = dayjs(options.startDate || new Date()).format('YYYY-MM-DD');
    const end = dayjs(options.endDate || options.startDate || new Date()).format('YYYY-MM-DD');

    const endpoint = `/E/${account.id}/emploidutemps.awp?verbe=get`;
    const value = await readResource<any>(this.ctx, 'timetable', endpoint, {
      accountId: account.id,
      suffix: `${start}.${end}`,
      body: { dateDebut: start, dateFin: end, avecTrous: false },
      mockMode: options.mockMode,
      force: options.force,
    });
    if (isMondaySundayWeek(start, end) && !options.force) {
      void prefetchNeighbours(this.ctx, account.id, start, end);
    }
    return value;
  };

  /**
   * Fetch the absolute iCal subscription URL for the current account.
   * Never cached.
   *
   * @example
   * ```ts
   * const url = await ld.timetable.getTimetableIcalUrl();
   * ```
   */
  getTimetableIcalUrl = async (options: TimetableIcalUrlOptions = {}): Promise<string> => {
    const account = requireCurrentAccount(this.ctx);
    requireModule(this.ctx, 'timetable', options.mockMode);
    const endpoint = `/ical/E/${account.id}/url.awp?verbe=get`;

    const result = await edFetch<{ url: string }>(
      this.ctx,
      endpoint,
      postOptions({}, { mockMode: options.mockMode }),
    );
    return `https://api.ecoledirecte.com/v3/${result.url}`;
  };
}

/**
 * Fire-and-forget neighbour prefetch. Never delays the caller, never throws,
 * never chains, and never touches sync status or error events.
 */
async function prefetchNeighbours(
  ctx: EdContext,
  accountId: number,
  start: string,
  end: string,
): Promise<void> {
  const neighbours = neighbourWeeks(start, end);
  if (!neighbours) return;
  if (!isOnline(ctx)) return;
  if (!ctx.account) return;
  const gen = ctx.sessionGen;
  for (const [ns, ne] of neighbours) {
    if (ctx.sessionGen !== gen || ctx.destroyed) return;
    const key = keyFor('timetable', accountId, `${ns}.${ne}`);
    const slot = ctx.cacheMem.get(key);
    if (slot) {
      const now = ctxNow(ctx);
      const age = now - slot.fetchedAt;
      if (Number.isFinite(slot.fetchedAt) && slot.fetchedAt <= now && age < 60_000) continue;
    }
    if (ctx.cacheInflight.has(key)) continue;
    const marker = runAsBackground(ctx, async () => {
      if (ctx.sessionGen !== gen || ctx.destroyed || !isOnline(ctx)) return null;
      const env = await edFetch<{ data: unknown }>(
        ctx,
        `/E/${accountId}/emploidutemps.awp?verbe=get`,
        postOptions(
          { dateDebut: ns, dateFin: ne, avecTrous: false },
          { returnEnvelope: true, background: true },
        ),
      );
      if (ctx.sessionGen !== gen || ctx.destroyed) return null;
      writeEntry(
        ctx,
        key,
        'timetable',
        accountId,
        (env as unknown as { data: unknown }).data,
        true,
      );
      return ctx.cacheMem.get(key)?.value ?? null;
    });
    ctx.cacheInflight.set(key, marker);
    try {
      await marker;
    } catch {
    } finally {
      if (ctx.cacheInflight.get(key) === marker) ctx.cacheInflight.delete(key);
    }
  }
}
