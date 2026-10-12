// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import { edFetch } from './fetch';
import { getConfig, type EdContext } from './context';
import { requireCurrentAccount } from './request';
import { EdValidationError } from './errors';

export type DownloadFormat = 'buffer' | 'blob' | 'stream';

export interface DownloadOptions {
  as?: DownloadFormat;
  params?: Record<string, unknown>;
  mockMode?: boolean;
}

export interface DownloadPhotoOptions {
  as?: DownloadFormat;
  mockMode?: boolean;
}

/**
 * Downloads namespace (no module check: file downloads map to no verified module code).
 *
 * @example
 * ```ts
 * const buf = await ld.downloads.download({ params: { id: 8651 } });
 * ```
 */
export class DownloadsNamespace {
  constructor(private ctx: EdContext) {}

  /**
   * Download a file from the `telechargement` endpoint.
   *
   * @example
   * ```ts
   * const buf = await ld.downloads.download({ params: { id: 8651 } });
   * ```
   */
  download = async (options: DownloadOptions = {}): Promise<ArrayBuffer | Blob | ReadableStream> =>
    download(this.ctx, options);

  /**
   * Download the current account's profile photo (`null` when none).
   *
   * @example
   * ```ts
   * const photo = await ld.downloads.downloadPhoto({ as: 'blob' });
   * ```
   */
  downloadPhoto = async (
    options: DownloadPhotoOptions = {},
  ): Promise<ArrayBuffer | Blob | ReadableStream | null> => downloadPhoto(this.ctx, options);
}

export async function download(
  ctx: EdContext,
  options: DownloadOptions = {},
): Promise<ArrayBuffer | Blob | ReadableStream> {
  const token = ctx.token;

  const response = await edFetch<Response>(ctx, '/telechargement.awp?verbe=get', {
    method: 'POST',
    body: {
      ...options.params,
      token,
    },
    skipAuth: true,
    isDownload: true,
    mockMode: options.mockMode,
  });

  return formatDownloadResponse(response, options.as ?? 'buffer');
}

export async function downloadPhoto(
  ctx: EdContext,
  options: DownloadPhotoOptions = {},
): Promise<ArrayBuffer | Blob | ReadableStream | null> {
  const account = requireCurrentAccount(ctx);
  const photoUrl = account.profile?.photo;
  if (!photoUrl) {
    return null;
  }

  let url = photoUrl;
  if (url.startsWith('//')) {
    url = `https:${url}`;
  } else if (!url.startsWith('http')) {
    const config = getConfig(ctx);
    const baseUrl = config.proxyUrl || 'https://api.ecoledirecte.com';
    url = `${baseUrl}${url}`;
  }

  const response = await edFetch<Response>(ctx, url, {
    method: 'GET',
    skipAuth: true,
    isDownload: true,
    mockMode: options.mockMode,
  });

  return formatDownloadResponse(response, options.as ?? 'buffer');
}

function formatDownloadResponse(
  response: Response,
  format: DownloadFormat,
): Promise<ArrayBuffer | Blob | ReadableStream> {
  switch (format) {
    case 'blob':
      return response.blob();
    case 'stream':
      if (!response.body) {
        throw new EdValidationError('Response body is null : cannot stream', 'INVALID_RESPONSE');
      }
      return Promise.resolve(response.body);
    case 'buffer':
    default:
      return response.arrayBuffer();
  }
}
