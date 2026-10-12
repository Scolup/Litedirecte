// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import { edFetch } from '../../core/fetch';
import { postOptions, requireCurrentAccount } from '../../core/request';
import { requireModule } from '../../core/modules';
import { encodeBase64 } from '../../core/transform';
import type { EdContext } from '../../core/context';
import { invalidateEntries, patchResourceEntries, readResource } from '../../core/cache';
import {
  assertNonEmptyArray,
  assertNonEmptyString,
  assertPositiveInteger,
  assertPositiveNumber,
  assertValidDate,
} from '../../core/validate';
import dayjs from 'dayjs';

export interface GetHomeworkOptions {
  mockMode?: boolean;
  /** Skip the cache, fetch from the network, and write the result through. */
  force?: boolean;
}

export interface GetHomeworkForDateOptions {
  mockMode?: boolean;
  /** Skip the cache, fetch from the network, and write the result through. */
  force?: boolean;
}

export interface HomeworkMutationOptions {
  mockMode?: boolean;
}

/**
 * Homework namespace (`CAHIER_DE_TEXTES` module).
 *
 * @example
 * ```ts
 * const index = await ld.homework.getHomework();
 * const day = await ld.homework.getHomeworkForDate('2026-03-23');
 * ```
 */
export class HomeworkNamespace {
  constructor(private ctx: EdContext) {}

  /**
   * Fetch the homework index (one request). Use `getHomeworkForDate` for details.
   *
   * @example
   * ```ts
   * const index = await ld.homework.getHomework();
   * ```
   */
  getHomework = async (options: GetHomeworkOptions = {}): Promise<any> => {
    const account = requireCurrentAccount(this.ctx);
    requireModule(this.ctx, 'homework', options.mockMode);
    const endpoint = `/Eleves/${account.id}/cahierdetexte.awp?verbe=get`;
    return readResource<any>(this.ctx, 'homework', endpoint, {
      accountId: account.id,
      suffix: 'index',
      mockMode: options.mockMode,
      force: options.force,
    });
  };

  /**
   * Fetch homework details for one date.
   *
   * @example
   * ```ts
   * const day = await ld.homework.getHomeworkForDate('2026-03-23');
   * ```
   */
  getHomeworkForDate = async (
    date: string | Date,
    options: GetHomeworkForDateOptions = {},
  ): Promise<any> => {
    const account = requireCurrentAccount(this.ctx);
    requireModule(this.ctx, 'homework', options.mockMode);
    assertValidDate(date, 'date');
    const formattedDate = dayjs(date).format('YYYY-MM-DD');
    const endpoint = `/Eleves/${account.id}/cahierdetexte/${formattedDate}.awp?verbe=get`;
    return readResource<any>(this.ctx, 'homework', endpoint, {
      accountId: account.id,
      suffix: `date=${formattedDate}`,
      mockMode: options.mockMode,
      force: options.force,
    });
  };

  /**
   * Mark homework entries as done.
   *
   * @example
   * ```ts
   * await ld.homework.markAsDone([42]);
   * ```
   */
  markAsDone = async (homeworkIds: number[], options: HomeworkMutationOptions = {}): Promise<any> =>
    setDoneState(this.ctx, homeworkIds, true, options);

  /**
   * Mark homework entries as not done.
   *
   * @example
   * ```ts
   * await ld.homework.markAsUndone([42]);
   * ```
   */
  markAsUndone = async (
    homeworkIds: number[],
    options: HomeworkMutationOptions = {},
  ): Promise<any> => setDoneState(this.ctx, homeworkIds, false, options);

  /**
   * Send a comment on a homework entry.
   *
   * @example
   * ```ts
   * await ld.homework.sendHomeworkComment(10330, 'Is this graded?');
   * ```
   */
  sendHomeworkComment = async (
    idContenu: number,
    message: string,
    options: HomeworkMutationOptions = {},
  ): Promise<{ id: number }> => {
    assertPositiveNumber(idContenu, 'idContenu');
    assertNonEmptyString(message, 'message');
    const account = requireCurrentAccount(this.ctx);
    requireModule(this.ctx, 'homework', options.mockMode);
    const endpoint = `/eleves/${account.id}/afaire/commentaires.awp?verbe=post`;
    const result = await edFetch<{ id: number }>(this.ctx, endpoint, {
      ...postOptions({ idContenu, message: encodeBase64(message) }),
      queued: true,
      mockMode: options.mockMode,
    });
    if (!options.mockMode) invalidateEntries(this.ctx, 'homework');
    return result;
  };
}

async function setDoneState(
  ctx: EdContext,
  homeworkIds: number[],
  done: boolean,
  options: HomeworkMutationOptions,
): Promise<any> {
  assertNonEmptyArray(homeworkIds, 'homeworkIds');
  for (const id of homeworkIds) assertPositiveInteger(id, 'homeworkId');
  const account = requireCurrentAccount(ctx);
  requireModule(ctx, 'homework', options.mockMode);
  const result = await edFetch<any>(ctx, `/Eleves/${account.id}/cahierdetexte.awp?verbe=put`, {
    ...postOptions({
      idDevoirsEffectues: done ? homeworkIds : [],
      idDevoirsNonEffectues: done ? [] : homeworkIds,
    }),
    queued: true,
    mockMode: options.mockMode,
  });
  if (!options.mockMode) patchHomeworkDone(ctx, homeworkIds, done);
  return result;
}

function patchHomeworkDone(ctx: EdContext, ids: number[], done: boolean): void {
  patchResourceEntries(ctx, 'homework', ids, {
    idField: 'idDevoir',
    apply: (rec) => {
      if (!('effectue' in rec) || rec.effectue === done) return false;
      rec.effectue = done;
      return true;
    },
  });
}
