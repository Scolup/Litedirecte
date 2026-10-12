// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import dayjs from 'dayjs';

export function decodeBase64(value: string): string {
  const binary = atob(value.replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

export function safeDecodeBase64(value: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    return value;
  }
  const compact = value.replace(/[\r\n]/g, '');
  if (compact.length < 4 || compact.length % 4 !== 0) {
    return value;
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    return value;
  }
  try {
    const decoded = decodeBase64(value);
    if (decoded.includes('\uFFFD') || /[\0-\b\v\f\x0e-\x1f\x7f]/.test(decoded)) {
      return value;
    }
    return decoded;
  } catch {
    return value;
  }
}

export function encodeBase64(value: string): string {
  return btoa(unescape(encodeURIComponent(value)));
}

/**
 * EcoleDirecte reads base64-decoded message bytes as Latin-1, so raw UTF-8
 * accents would arrive as mojibake (`é` → `Ã©`). Message bodies are HTML,
 * where numeric entities render identically — encoding them keeps the
 * payload pure ASCII and immune to the mismatch.
 */
export function toAsciiEntities(value: string): string {
  return value.replace(/[^\x00-\x7F]/gu, (c) => `&#${c.codePointAt(0)};`);
}

function isDateString(value: any): boolean {
  if (typeof value !== 'string') return false;
  return /^\d{4}-\d{2}-\d{2}(\s|T)?(\d{2}:\d{2}(:\d{2})?)?$/.test(value);
}

function convertDate(value: string): Date | string {
  const d = dayjs(value);
  return d.isValid() ? d.toDate() : value;
}

export function transform(data: any): any {
  if (data === null || data === undefined) return data;

  if (Array.isArray(data)) {
    return data.map(transform);
  }

  if (typeof data === 'object') {
    if (data instanceof Date) return data;

    const result: any = {};
    for (const key of Object.keys(data)) {
      let value = data[key];

      if (isDateString(value)) {
        value = convertDate(value);
      } else if (typeof value === 'string') {
        if (
          key === 'question' ||
          key === 'enonce' ||
          key === 'contenu' ||
          key === 'content' ||
          key === 'message' ||
          key.startsWith('libelleEval')
        ) {
          value = safeDecodeBase64(value);
        } else {
          value = transform(value);
        }
      } else if (key === 'propositions' && Array.isArray(value)) {
        value = value.map((v) => (typeof v === 'string' ? safeDecodeBase64(v) : v));
      } else {
        value = transform(value);
      }

      result[key] = value;
    }
    return result;
  }

  return data;
}
