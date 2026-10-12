// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import { edFetch } from '../../core/fetch';
import { postOptions, requireCurrentAccount } from '../../core/request';
import { assertIntegerInRange } from '../../core/validate';
import { readResource } from '../../core/cache';
import type { EdContext } from '../../core/context';
import type { CloudNode, CloudEntry } from '../../types';

export interface GetCloudOptions {
  depth?: number;
  mockMode?: boolean;
  /** Skip the cache, fetch from the network, and write the result through. */
  force?: boolean;
}

export interface CloudMutationOptions {
  mockMode?: boolean;
}

/**
 * Cloud storage namespace (no module check: EcoleDirecte exposes no verified module code for it).
 *
 * @example
 * ```ts
 * const root = await ld.cloud.getCloud();
 * ```
 */
export class CloudNamespace {
  constructor(private ctx: EdContext) {}

  /**
   * List cloud entries up to `depth` levels (1-10, default 3).
   *
   * @example
   * ```ts
   * const root = await ld.cloud.getCloud({ depth: 2 });
   * ```
   */
  getCloud = async (options: GetCloudOptions = {}): Promise<CloudEntry[]> => {
    const account = requireCurrentAccount(this.ctx);
    const endpoint = `/cloud/E/${account.id}.awp?verbe=get`;
    const { depth, mockMode, force } = options;
    if (depth !== undefined) assertIntegerInRange(depth, 'depth', 1, 10);
    const normalized = depth || 3;
    return readResource<CloudEntry[]>(this.ctx, 'cloud', endpoint, {
      accountId: account.id,
      suffix: `depth=${normalized}`,
      body: { profondeur: normalized },
      mockMode,
      force,
    });
  };

  /**
   * Create a folder inside a parent node.
   *
   * @example
   * ```ts
   * const folder = await ld.cloud.createFolder('Reports', parent);
   * ```
   */
  createFolder = async (
    name: string,
    parentNode: CloudNode,
    options: CloudMutationOptions = {},
  ): Promise<CloudNode> => {
    const account = requireCurrentAccount(this.ctx);
    const endpoint = `/cloud/E/${account.id}.awp?verbe=post`;
    return edFetch<CloudNode>(
      this.ctx,
      endpoint,
      postOptions(
        { parentNode, libelle: name, typeRessource: 'folder' },
        { queued: true, mockMode: options.mockMode },
      ),
    );
  };

  /**
   * Delete (move to trash) cloud nodes.
   *
   * @example
   * ```ts
   * await ld.cloud.deleteNodes([node]);
   * ```
   */
  deleteNodes = async (
    nodes: CloudNode[],
    options: CloudMutationOptions = {},
  ): Promise<{ success: boolean }> => {
    const account = requireCurrentAccount(this.ctx);
    const endpoint = `/cloud/E/${account.id}/visibility.awp?verbe=delete`;
    return edFetch<{ success: boolean }>(
      this.ctx,
      endpoint,
      postOptions({ tabNodes: nodes }, { queued: true, mockMode: options.mockMode }),
    );
  };
}
