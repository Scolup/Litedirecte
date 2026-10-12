// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import { requireCurrentAccount } from '../../core/request';
import { requireModule } from '../../core/modules';
import { readResource } from '../../core/cache';
import type { EdContext } from '../../core/context';

export interface GetAttendanceOptions {
  mockMode?: boolean;
  /** Skip the cache, fetch from the network, and write the result through. */
  force?: boolean;
}

/**
 * Attendance namespace (`VIE_SCOLAIRE` module).
 *
 * @example
 * ```ts
 * const life = await ld.attendance.getAttendance();
 * ```
 */
export class AttendanceNamespace {
  constructor(private ctx: EdContext) {}

  /**
   * Fetch absences, delays and related school-life data.
   *
   * @example
   * ```ts
   * const life = await ld.attendance.getAttendance();
   * ```
   */
  getAttendance = async (options: GetAttendanceOptions = {}): Promise<any> => {
    const account = requireCurrentAccount(this.ctx);
    requireModule(this.ctx, 'attendance', options.mockMode);
    return readResource<any>(
      this.ctx,
      'attendance',
      `/eleves/${account.id}/viescolaire.awp?verbe=get`,
      { accountId: account.id, suffix: 'list', mockMode: options.mockMode, force: options.force },
    );
  };
}
