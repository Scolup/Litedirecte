// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import { describe, it, expect } from 'bun:test';
import { transform, decodeBase64, safeDecodeBase64 } from '../src/core/transform';

describe('Transform Module', () => {
  describe('decodeBase64', () => {
    it('decodes valid base64', () => {
      expect(decodeBase64(btoa('hello'))).toBe('hello');
    });
    it('handles UTF-8 characters', () => {
      const input = 'café résumé';
      const encoded = btoa(unescape(encodeURIComponent(input)));
      expect(decodeBase64(encoded)).toBe(input);
    });
  });

  describe('safeDecodeBase64', () => {
    it('returns short strings as-is if not valid base64', () => {
      expect(safeDecodeBase64('hi')).toBe('hi');
    });
    it('decodes valid base64 strings', () => {
      const long = 'a'.repeat(25);
      const encoded = btoa(long);
      expect(safeDecodeBase64(encoded)).toBe(long);
    });
    it('returns invalid base64 as-is gracefully', () => {
      expect(safeDecodeBase64('!!!not-base64!!!')).toBe('!!!not-base64!!!');
    });
  });

  describe('transform', () => {
    it('preserves keys and does not rename them', () => {
      const result = transform({ valeur: '15', noteSur: '20' });
      expect(result).toEqual({ valeur: '15', noteSur: '20' });
    });

    it('does not coerce boolean fields from 0/1 strings', () => {
      const result = transform({
        interrogation: '1',
        enLettre: '0',
      });
      expect(result.interrogation).toBe('1');
      expect(result.enLettre).toBe('0');
    });

    it('converts date strings to Date objects', () => {
      const result = transform({ dateSaisie: '2023-10-15' } as any);
      expect(result.dateSaisie).toBeInstanceOf(Date);
    });

    it('converts datetime strings to Date objects', () => {
      const result = transform({ start_date: '2023-10-15 08:30' } as any);
      expect(result.start_date).toBeInstanceOf(Date);
    });

    it('preserves null for any fields', () => {
      const result = transform({
        moyenne: null,
        valeur: null,
        val: null,
        foo: null,
      } as any);
      expect(result.moyenne).toBeNull();
      expect(result.valeur).toBeNull();
      expect(result.val).toBeNull();
      expect(result.foo).toBeNull();
    });

    it('transforms nested objects recursively', () => {
      const result = transform({
        notes: [{ valeur: '15', noteSur: '20' }],
      } as any);
      expect(result.notes[0].valeur).toBe('15');
      expect(result.notes[0].noteSur).toBe('20');
    });

    it('handles empty arrays', () => {
      expect(transform([])).toEqual([]);
    });

    it('handles empty objects', () => {
      expect(transform({})).toEqual({});
    });

    it('handles null/undefined input', () => {
      expect(transform(null)).toBeNull();
      expect(transform(undefined)).toBeUndefined();
    });

    it('returns primitives unchanged', () => {
      expect(transform('hello')).toBe('hello');
      expect(transform(42)).toBe(42);
      expect(transform(true)).toBe(true);
    });

    it('handles Date objects by returning them as-is', () => {
      const d = new Date('2023-01-01');
      expect(transform(d)).toBe(d);
    });

    it('decodes specific keys automatically', () => {
      const result = transform({
        question: btoa('test question'),
        enonce: btoa('test enonce'),
        contenu: btoa('test contenu'),
        content: btoa('test content'),
        message: btoa('test message'),
        libelleEval1: btoa('test libelleEval1'),
      });
      expect(result.question).toBe('test question');
      expect(result.enonce).toBe('test enonce');
      expect(result.contenu).toBe('test contenu');
      expect(result.content).toBe('test content');
      expect(result.message).toBe('test message');
      expect(result.libelleEval1).toBe('test libelleEval1');
    });

    it('decodes propositions array of strings automatically', () => {
      const result = transform({
        propositions: [btoa('choice1'), btoa('choice2')],
      });
      expect(result.propositions).toEqual(['choice1', 'choice2']);
    });
  });

  describe('B6: safeDecodeBase64 plain-text guard', () => {
    function b64encode(str: string): string {
      const bytes = new TextEncoder().encode(str);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    }
    it('leaves plain words untouched', () => {
      for (const word of ['Anglais', 'A demain', 'Bonjour', 'Test']) {
        expect(safeDecodeBase64(word)).toBe(word);
      }
    });
    it('leaves all 4-letter lowercase words untouched unless clean base64', () => {
      const re = /^[A-Za-z0-9+/]+={0,2}$/;
      let checked = 0;
      for (let a = 97; a <= 122; a++) {
        for (let b = 97; b <= 122; b++) {
          for (let c = 97; c <= 122; c++) {
            for (let d = 97; d <= 122; d++) {
              const word = String.fromCharCode(a, b, c, d);
              const out = safeDecodeBase64(word);
              if (out !== word) {
                // Only legitimate clean decodes may change the value.
                expect(word.length % 4 === 0 && re.test(word)).toBe(true);
                expect(out.includes('�')).toBe(false);
                // eslint-disable-next-line no-control-regex
                expect(/[\0-\b\v\f\x0e-\x1f\x7f]/.test(out)).toBe(false);
              }
              checked++;
            }
          }
        }
      }
      expect(checked).toBe(456_976);
    });
    it('still decodes real base64: accented, multi-line and MIME-chunked', () => {
      expect(safeDecodeBase64(b64encode('café résumé'))).toBe('café résumé');
      const multiline = b64encode('Hello\nWorld, this is a longer message with lines.');
      const chunked = multiline.replace(/(.{76})/g, '$1\r\n');
      expect(safeDecodeBase64(multiline)).toBe(
        'Hello\nWorld, this is a longer message with lines.',
      );
      expect(safeDecodeBase64(chunked)).toBe('Hello\nWorld, this is a longer message with lines.');
      const long = b64encode('x'.repeat(200));
      const mime = long.replace(/(.{76})/g, '$1\r\n');
      expect(safeDecodeBase64(mime)).toBe('x'.repeat(200));
    });
  });
});
