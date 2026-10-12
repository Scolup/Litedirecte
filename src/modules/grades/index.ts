// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import { requireCurrentAccount } from '../../core/request';
import { requireModule } from '../../core/modules';
import { readResource } from '../../core/cache';
import type { EdContext } from '../../core/context';
import type { Correlation } from '../timeline/correlator';
import { correlateGrades } from '../timeline/correlator';

export interface GetGradesOptions {
  periodId?: string;
  mockMode?: boolean;
  /** Skip the cache, fetch from the network, and write the result through. */
  force?: boolean;
}

/**
 * Grades namespace (`NOTES` module).
 *
 * @example
 * ```ts
 * const grades = await ld.grades.getGrades();
 * ```
 */
export class GradesNamespace {
  constructor(private ctx: EdContext) {}

  /**
   * Fetch grades for the current account.
   *
   * @example
   * ```ts
   * const grades = await ld.grades.getGrades();
   * const { getGrades } = ld.grades;
   * const same = await getGrades();
   * ```
   */
  getGrades = async (options: GetGradesOptions = {}): Promise<any> => {
    const account = requireCurrentAccount(this.ctx);
    requireModule(this.ctx, 'grades', options.mockMode);
    const endpoint = `/eleves/${account.id}/notes.awp?verbe=get`;
    const body = { anneeScolaire: options.periodId || '' };
    return readResource<any>(this.ctx, 'grades', endpoint, {
      accountId: account.id,
      suffix: `period=${options.periodId || ''}`,
      body,
      mockMode: options.mockMode,
      force: options.force,
    });
  };

  /**
   * Correlate grades (trends and day-of-week patterns, 5+ grades per subject).
   *
   * @example
   * ```ts
   * const correlations = await ld.grades.correlate();
   * ```
   */
  correlate = async (options: { mockMode?: boolean } = {}): Promise<Correlation[]> => {
    const gradesData = (await this.getGrades(options)) as any;
    return correlateGrades(gradesData);
  };
}
