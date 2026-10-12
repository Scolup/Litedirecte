// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import { requireCurrentAccount } from '../../core/request';
import { readResource } from '../../core/cache';
import type { EdContext } from '../../core/context';

export interface GetDocumentsOptions {
  mockMode?: boolean;
  /** Skip the cache, fetch from the network, and write the result through. */
  force?: boolean;
}

/**
 * Documents namespace (no module check: EcoleDirecte exposes no verified module code for it).
 *
 * @example
 * ```ts
 * const docs = await ld.documents.getDocuments();
 * ```
 */
export class DocumentsNamespace {
  constructor(private ctx: EdContext) {}

  /**
   * Fetch administrative and school documents.
   *
   * @example
   * ```ts
   * const docs = await ld.documents.getDocuments();
   * ```
   */
  getDocuments = async (options: GetDocumentsOptions = {}): Promise<any> => {
    const account = requireCurrentAccount(this.ctx);
    return readResource<any>(this.ctx, 'documents', '/elevesDocuments.awp?verbe=get', {
      accountId: account.id,
      suffix: 'list',
      mockMode: options.mockMode,
      force: options.force,
    });
  };
}
