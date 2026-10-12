// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import { requireCurrentAccount } from '../../core/request';
import { readResource } from '../../core/cache';
import type { EdContext } from '../../core/context';

export interface TimelineOptions {
  mockMode?: boolean;
  /** Skip the cache, fetch from the network, and write the result through. */
  force?: boolean;
}

/**
 * Timeline namespace (no module check: EcoleDirecte exposes no verified module code for it).
 *
 * @example
 * ```ts
 * const feed = await ld.timeline.getTimeline();
 * ```
 */
export class TimelineNamespace {
  constructor(private ctx: EdContext) {}

  /**
   * Fetch the student's timeline.
   *
   * @example
   * ```ts
   * const feed = await ld.timeline.getTimeline();
   * ```
   */
  getTimeline = async (options: TimelineOptions = {}): Promise<any> => {
    const account = requireCurrentAccount(this.ctx);
    return readResource<any>(this.ctx, 'timeline', `/eleves/${account.id}/timeline.awp?verbe=get`, {
      accountId: account.id,
      suffix: 'list',
      mockMode: options.mockMode,
      force: options.force,
    });
  };

  /**
   * Fetch the shared school timeline.
   *
   * @example
   * ```ts
   * const common = await ld.timeline.getCommonTimeline();
   * ```
   */
  getCommonTimeline = async (options: TimelineOptions = {}): Promise<any> => {
    const account = requireCurrentAccount(this.ctx);
    return readResource<any>(
      this.ctx,
      'commonTimeline',
      `/E/${account.id}/timelineAccueilCommun.awp?verbe=get`,
      {
        accountId: account.id,
        suffix: 'list',
        mockMode: options.mockMode,
        force: options.force,
      },
    );
  };
}

export * from './correlator';
