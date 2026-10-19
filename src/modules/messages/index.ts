// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import { edFetch, type FetchOptions } from '../../core/fetch';
import { postOptions, requireCurrentAccount } from '../../core/request';
import { encodeBase64, toAsciiEntities } from '../../core/transform';
import { EdValidationError } from '../../core/errors';
import type { EdContext } from '../../core/context';
import {
  deleteEntries,
  invalidateEntries,
  patchResourceEntries,
  readResource,
} from '../../core/cache';
import {
  assertNonEmptyString,
  assertNonEmptyArray,
  assertNonNegativeInteger,
  assertPositiveNumber,
} from '../../core/validate';

export interface GetMessagesOptions {
  folderId?: number;
  page?: number;
  year?: string;
  mockMode?: boolean;
  /** Skip the cache, fetch from the network, and write the result through. */
  force?: boolean;
}

export interface GetMessageOptions {
  year?: string;
  mode?: 'destinataire' | 'expediteur';
  mockMode?: boolean;
  /** Skip the cache, fetch from the network, and write the result through. */
  force?: boolean;
}

const YEAR_PATTERN = /^(\d{4})-(\d{4})$/;

function resolveYear(year: string | undefined): string {
  if (year === undefined || year === '') return '';
  const match = YEAR_PATTERN.exec(year);
  if (!match || Number(match[2]) !== Number(match[1]) + 1) {
    throw new EdValidationError(
      `year must be a school year like "2024-2025", got ${JSON.stringify(year)}`,
      'INVALID_ARGUMENT',
    );
  }
  return year;
}

function normalizeMessageIds(ids: number | number[]): number[] {
  const list = Array.isArray(ids) ? ids : [ids];
  if (list.length === 0) {
    throw new EdValidationError('message ids must not be empty', 'INVALID_ARGUMENT');
  }
  for (const id of list) {
    assertPositiveNumber(id, 'message id');
  }
  return list;
}

/** `P` for teachers, `A` for school staff (administrative personnel). */
export type ContactType = 'P' | 'A';

export interface GetContactsOptions {
  /** Whom to list: teachers (default) or school staff. */
  type?: ContactType;
  /** Defaults to the logged-in account's class (`profile.classe.id` returned by login). */
  classId?: number;
  mockMode?: boolean;
  /** Skip the cache, fetch from the network, and write the result through. */
  force?: boolean;
}

export interface MessageAttachmentRef {
  /** Chemin `unc` rendu par `uploadAttachment` (stock temporaire). */
  unc: string;
  /** Nom du fichier, tel que le destinataire le verra. */
  libelle: string;
  /** Par défaut : même valeur que `libelle`. */
  displayText?: string;
}

export interface SendMessageData {
  subject: string;
  content: string;
  destinataires: unknown[];
  /** Pièces jointes préalablement téléversées via `uploadAttachment`. */
  files?: MessageAttachmentRef[];
}

export interface SendMessageOptions {
  mockMode?: boolean;
}

export interface UploadAttachmentOptions {
  mockMode?: boolean;
}

export interface MarkMessageOptions {
  year?: string;
  mockMode?: boolean;
}

/**
 * Messages namespace (no module check: EcoleDirecte exposes no verified module code for it).
 *
 * @example
 * ```ts
 * const inbox = await ld.messages.getMessages();
 * ```
 */
export class MessagesNamespace {
  constructor(private ctx: EdContext) {}

  /**
   * Fetch the message list (exactly one request). Fetch bodies explicitly with `getMessage`.
   *
   * @example
   * ```ts
   * const inbox = await ld.messages.getMessages();
   * ```
   */
  getMessages = async (options: GetMessagesOptions = {}): Promise<any> => {
    const { folderId, page = 0, year, mockMode, force } = options;
    assertNonNegativeInteger(page, 'page');
    const account = requireCurrentAccount(this.ctx);
    const resolvedYear = resolveYear(year);
    const endpoint =
      folderId !== undefined
        ? `/eleves/${account.id}/messages.awp?force=false&typeRecuperation=classeur&idClasseur=${folderId}&orderBy=date&order=desc&query=&onlyRead=&page=${page}&itemsPerPage=100&getAll=0&verbe=get`
        : `/eleves/${account.id}/messages.awp?verbe=get&getAll=1&force=true`;
    return readResource<any>(this.ctx, 'messages', endpoint, {
      accountId: account.id,
      suffix: `list.year=${resolvedYear}.folder=${folderId ?? ''}.page=${page}`,
      body: { anneeMessages: resolvedYear },
      mockMode,
      force,
    });
  };

  /**
   * Fetch one message body. Note: opening a message marks it as **read** on
   * EcoleDirecte's servers; call `markAsUnread` to restore the unread state.
   *
   * @example
   * ```ts
   * const message = await ld.messages.getMessage(12345);
   * await ld.messages.markAsUnread(12345);
   * ```
   */
  getMessage = async (id: number, options: GetMessageOptions = {}): Promise<any> => {
    assertPositiveNumber(id, 'message id');
    const account = requireCurrentAccount(this.ctx);
    const mode = options.mode ?? 'destinataire';
    const resolvedYear = resolveYear(options.year);
    const endpoint = `/eleves/${account.id}/messages/${id}.awp?verbe=get&mode=${mode}`;
    return readResource<any>(this.ctx, 'messages', endpoint, {
      accountId: account.id,
      suffix: `detail.${id}.${mode}.${resolvedYear}`,
      body: { anneeMessages: resolvedYear },
      mockMode: options.mockMode,
      force: options.force,
    });
  };

  /**
   * List the contacts you can write to — the recipient list for `sendMessage`.
   * Answers the raw `{ contacts: [...] }` payload, where each entry already
   * carries the `id` / `type` pair `sendMessage` expects.
   *
   * @example
   * ```ts
   * const { contacts } = await ld.messages.getContacts();
   * await ld.messages.sendMessage({ subject: 'Hello', content: 'World', destinataires: [contacts[0]] });
   * ```
   */
  getContacts = async (options: GetContactsOptions = {}): Promise<any> => {
    const type = options.type ?? 'P';
    const account = requireCurrentAccount(this.ctx);
    const classId = options.classId ?? account.profile?.classe?.id;
    if (classId === undefined) {
      throw new EdValidationError(
        'no class id for the current account: pass classId (accounts without a class, e.g. staff)',
        'INVALID_ARGUMENT',
      );
    }
    assertNonNegativeInteger(classId, 'classId');
    const resource = type === 'P' ? 'professeurs' : 'personnels';
    const endpoint = `/messagerie/contacts/${resource}.awp?nom=&idClasse=${classId}&verbe=get`;
    return readResource<any>(this.ctx, 'messages', endpoint, {
      accountId: account.id,
      suffix: `contacts.${type}.${classId}`,
      body: {},
      mockMode: options.mockMode,
      force: options.force,
    });
  };

  /**
   * Upload a file to EcoleDirecte's temporary stock (`STOCK-TMP`).
   * Returns the `unc` + `libelle` pair to pass as `files` to `sendMessage`.
   * The file is NOT stored in the cloud : `unc` is a temporary path consumed
   * by the subsequent send.
   *
   * Field name observed on the official web app : `file` (single file).
   *
   * @example
   * ```ts
   * const { unc, libelle } = await ld.messages.uploadAttachment(new File([buf], 'devoir.pdf'));
   * await ld.messages.sendMessage({ subject: 'Hello', content: 'World', destinataires: [teacher], files: [{ unc, libelle }] });
   * ```
   */
  uploadAttachment = async (
    file: Blob,
    filename?: string,
    options: UploadAttachmentOptions = {},
  ): Promise<{ unc: string; libelle: string }> => {
    requireCurrentAccount(this.ctx);
    const name =
      filename ?? (typeof File !== 'undefined' && file instanceof File ? file.name : undefined);
    assertNonEmptyString(name, 'filename');
    if (!(file instanceof Blob)) {
      throw new EdValidationError('file must be a Blob or File', 'INVALID_ARGUMENT');
    }

    const form = new FormData();
    form.append('file', file, name);

    return edFetch<{ unc: string; libelle: string }>(this.ctx, '/televersement.awp?verbe=post', {
      body: form,
      // Un binaire ne se rejoue pas dans la file hors-ligne : pas de queue.
      skipQueue: true,
      mockMode: options.mockMode,
    });
  };

  /**
   * Send a message.
   *
   * @example
   * ```ts
   * await ld.messages.sendMessage({ subject: 'Hello', content: 'World', destinataires: [] });
   * ```
   */
  sendMessage = async (
    data: SendMessageData,
    options: SendMessageOptions = {},
  ): Promise<{ success: boolean }> => {
    assertNonEmptyString(data.subject, 'subject');
    assertNonEmptyString(data.content, 'content');
    assertNonEmptyArray(data.destinataires, 'destinataires');

    const account = requireCurrentAccount(this.ctx);

    const endpoint = `/eleves/${account.id}/messages.awp?verbe=post`;
    const result = await edFetch<{ success: boolean }>(this.ctx, endpoint, {
      ...postOptions({
        message: {
          subject: data.subject,
          content: encodeBase64(toAsciiEntities(data.content)),
          groupesDestinataires: [
            {
              destinataires: data.destinataires,
              selection: { type: 'P' },
            },
          ],
          transfertFiles: [],
          files: (data.files ?? []).map((f) => ({
            id: '0',
            libelle: f.libelle,
            displayText: f.displayText ?? f.libelle,
            unc: f.unc,
          })),
          from: { role: account.typeCompte, id: account.id, read: true },
        },
        anneeMessages: '',
      }),
      queued: true,
      mockMode: options.mockMode,
    });
    if (!options.mockMode) invalidateEntries(this.ctx, 'messages');
    return result;
  };

  /**
   * Mark messages as read.
   *
   * @example
   * ```ts
   * await ld.messages.markAsRead([12345]);
   * ```
   */
  markAsRead = async (
    ids: number | number[],
    options: MarkMessageOptions = {},
  ): Promise<{ success: boolean }> => {
    const account = requireCurrentAccount(this.ctx);
    const endpoint = `/eleves/${account.id}/messages.awp?verbe=put`;
    const normalized = normalizeMessageIds(ids);
    const result = await edFetch<{ success: boolean }>(
      this.ctx,
      endpoint,
      setReadState(normalized, true, options),
    );
    if (!options.mockMode) patchMessageRead(this.ctx, normalized, true);
    return result;
  };

  /**
   * Mark messages as unread (restores the unread state after `getMessage`).
   *
   * @example
   * ```ts
   * await ld.messages.markAsUnread(12345);
   * ```
   */
  markAsUnread = async (
    ids: number | number[],
    options: MarkMessageOptions = {},
  ): Promise<{ success: boolean }> => {
    const account = requireCurrentAccount(this.ctx);
    const endpoint = `/eleves/${account.id}/messages.awp?verbe=put`;
    const normalized = normalizeMessageIds(ids);
    const result = await edFetch<{ success: boolean }>(
      this.ctx,
      endpoint,
      setReadState(normalized, false, options),
    );
    if (!options.mockMode) {
      patchMessageRead(this.ctx, normalized, false);
      for (const id of normalized) {
        await deleteEntries(this.ctx, 'messages', `detail.${id}.`);
      }
    }
    return result;
  };

  getFolders = async (options: { mockMode?: boolean; force?: boolean } = {}): Promise<any> => {
    return edFetch<any>(this.ctx, '/messagerie/classeurs.awp?verbe=get', {
      ...postOptions({}, { mockMode: options.mockMode }),
      mockMode: options.mockMode,
    });
  };

  createFolder = async (name: string, options: { mockMode?: boolean } = {}): Promise<any> => {
    return edFetch<any>(this.ctx, '/messagerie/classeurs.awp?verbe=post', {
      ...postOptions({ libelle: name }, { mockMode: options.mockMode }),
      mockMode: options.mockMode,
    });
  };

  updateFolder = async (
    id: number,
    data: { libelle?: string },
    options: { mockMode?: boolean } = {},
  ): Promise<any> => {
    return edFetch<any>(this.ctx, `/messagerie/classeur/${id}.awp?verbe=put`, {
      ...postOptions({ id, ...data }, { mockMode: options.mockMode }),
      mockMode: options.mockMode,
    });
  };

  deleteFolder = async (id: number, options: { mockMode?: boolean } = {}): Promise<any> => {
    return edFetch<any>(this.ctx, `/messagerie/classeur/${id}.awp?verbe=delete`, {
      ...postOptions({}, { mockMode: options.mockMode }),
      mockMode: options.mockMode,
    });
  };

  archiveMessages = async (
    ids: number | number[],
    options: MarkMessageOptions = {},
  ): Promise<{ success: boolean }> => {
    const endpoint = `/eleves/${requireCurrentAccount(this.ctx).id}/messages.awp?verbe=put`;
    const normalized = normalizeMessageIds(ids);
    const result = await edFetch<{ success: boolean }>(
      this.ctx,
      endpoint,
      postOptions(
        { action: 'archiver', ids: normalized, anneeMessages: resolveYear(options.year) },
        { mockMode: options.mockMode },
      ),
    );
    return result;
  };

  unarchiveMessages = async (
    ids: number | number[],
    options: MarkMessageOptions = {},
  ): Promise<{ success: boolean }> => {
    const endpoint = `/eleves/${requireCurrentAccount(this.ctx).id}/messages.awp?verbe=put`;
    const normalized = normalizeMessageIds(ids);
    const result = await edFetch<{ success: boolean }>(
      this.ctx,
      endpoint,
      postOptions(
        { action: 'desarchiver', ids: normalized, anneeMessages: resolveYear(options.year) },
        { mockMode: options.mockMode },
      ),
    );
    return result;
  };

  moveToFolder = async (
    ids: number | number[],
    folderId: number,
    options: MarkMessageOptions = {},
  ): Promise<{ success: boolean }> => {
    const endpoint = `/eleves/${requireCurrentAccount(this.ctx).id}/messages.awp?verbe=put`;
    const normalized = normalizeMessageIds(ids);
    const result = await edFetch<{ success: boolean }>(
      this.ctx,
      endpoint,
      postOptions(
        {
          action: 'deplacer',
          idClasseur: folderId,
          ids: normalized.map((id) => `${id}:${-1}`),
          anneeMessages: resolveYear(options.year),
        },
        { mockMode: options.mockMode },
      ),
    );
    return result;
  };
}

/** Build the `marquerCommeLu`/`marquerCommeNonLu` request. */
function setReadState(ids: number[], read: boolean, options: MarkMessageOptions): FetchOptions {
  return postOptions(
    {
      action: read ? 'marquerCommeLu' : 'marquerCommeNonLu',
      ids,
      anneeMessages: resolveYear(options.year),
    },
    { mockMode: options.mockMode },
  );
}

function patchMessageRead(ctx: EdContext, ids: number[], read: boolean): void {
  patchResourceEntries(ctx, 'messages', ids, {
    idField: 'id',
    keyIncludes: '|list.',
    apply: (rec) => {
      if (!('read' in rec) || rec.read === read) return false;
      rec.read = read;
      return true;
    },
  });
}
