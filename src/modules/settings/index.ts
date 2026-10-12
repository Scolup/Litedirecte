// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import { edFetch } from '../../core/fetch';
import { postOptions, requireCurrentAccount } from '../../core/request';
import { readResource } from '../../core/cache';
import type { EdContext } from '../../core/context';

export interface SettingsOptions {
  mockMode?: boolean;
  /** Skip the cache, fetch from the network, and write the result through. */
  force?: boolean;
}

export interface UpdateSettingsData {
  email?: string;
  portable?: string;
  questionSecrete?: string;
  reponse?: string;
  nouveauMotDePasse?: string;
  identifiant?: string;
}

/**
 * Settings namespace (no module check: EcoleDirecte exposes no verified module code for it).
 *
 * @example
 * ```ts
 * const settings = await ld.settings.getSettings();
 * ```
 */
export class SettingsNamespace {
  constructor(private ctx: EdContext) {}

  /**
   * Fetch the login's personal settings.
   *
   * @example
   * ```ts
   * const settings = await ld.settings.getSettings();
   * ```
   */
  getSettings = async (options: SettingsOptions = {}): Promise<any> => {
    const account = requireCurrentAccount(this.ctx);
    const endpoint = `/logins/${account.idLogin}.awp?verbe=get`;
    return readResource<any>(this.ctx, 'settings', endpoint, {
      accountId: account.id,
      suffix: 'list',
      mockMode: options.mockMode,
      force: options.force,
    });
  };

  /**
   * Update personal settings (email, phone, password, ...).
   *
   * @example
   * ```ts
   * await ld.settings.updateSettings({ email: 'new@example.com' });
   * ```
   */
  updateSettings = async (
    data: UpdateSettingsData,
    options: SettingsOptions = {},
  ): Promise<any> => {
    const account = requireCurrentAccount(this.ctx);
    const payload: Record<string, string> = {
      identifiant: account.identifiant,
      ...data,
    };
    if (data.nouveauMotDePasse) {
      payload.confirmationMotDePasse = data.nouveauMotDePasse;
    }
    const endpoint = `/logins/${account.idLogin}.awp?verbe=put`;
    return edFetch<any>(this.ctx, endpoint, postOptions(payload, { mockMode: options.mockMode }));
  };

  /**
   * Toggle visual accessibility preferences.
   *
   * @example
   * ```ts
   * await ld.settings.updateAccessibility(true);
   * ```
   */
  updateAccessibility = async (
    enabled: boolean,
    options: SettingsOptions = {},
  ): Promise<{ success: boolean }> => {
    const account = requireCurrentAccount(this.ctx);

    return edFetch<{ success: boolean }>(
      this.ctx,
      `/parametreIndividuel.awp?verbe=put`,
      postOptions(
        {
          path: `Préférences/Elèves/accessibiliteVisuelle/${account.id}`,
          value: enabled ? '1' : '0',
        },
        { mockMode: options.mockMode },
      ),
    );
  };
}
