// © 2026 typeof (Scolup) | Licensed under AGPL 3.
import { describe, it, expect } from 'bun:test';
import {
  assertNonEmptyString,
  assertPositiveNumber,
  assertPositiveInteger,
  assertNonEmptyArray,
  assertIntegerInRange,
  assertNonNegativeInteger,
  assertValidDate,
} from '../src/core/validate';
import { EdApiError } from '../src/core/errors';

describe('Validate Module', () => {
  describe('assertNonEmptyString', () => {
    it('passes for valid strings', () => {
      expect(() => assertNonEmptyString('hello', 'test')).not.toThrow();
    });
    it('throws for empty string', () => {
      expect(() => assertNonEmptyString('', 'test')).toThrow(EdApiError);
    });
    it('throws for whitespace-only string', () => {
      expect(() => assertNonEmptyString('   ', 'test')).toThrow(EdApiError);
    });
    it('throws for non-string', () => {
      expect(() => assertNonEmptyString(123, 'test')).toThrow(EdApiError);
    });
    it('throws for null', () => {
      expect(() => assertNonEmptyString(null, 'test')).toThrow(EdApiError);
    });
  });

  describe('assertPositiveNumber', () => {
    it('passes for positive numbers', () => {
      expect(() => assertPositiveNumber(1, 'test')).not.toThrow();
      expect(() => assertPositiveNumber(0.5, 'test')).not.toThrow();
    });
    it('throws for zero', () => {
      expect(() => assertPositiveNumber(0, 'test')).toThrow(EdApiError);
    });
    it('throws for negative', () => {
      expect(() => assertPositiveNumber(-1, 'test')).toThrow(EdApiError);
    });
    it('throws for Infinity', () => {
      expect(() => assertPositiveNumber(Infinity, 'test')).toThrow(EdApiError);
    });
    it('throws for non-number', () => {
      expect(() => assertPositiveNumber('1', 'test')).toThrow(EdApiError);
    });
  });

  describe('assertPositiveInteger', () => {
    it('passes for positive integers', () => {
      expect(() => assertPositiveInteger(1, 'test')).not.toThrow();
    });
    it('throws for zero, negatives, fractions and non-numbers', () => {
      for (const bad of [0, -1, 1.5, NaN, Infinity, '1', null]) {
        expect(() => assertPositiveInteger(bad, 'test')).toThrow(EdApiError);
      }
    });
  });

  describe('assertNonEmptyArray', () => {
    it('passes for non-empty arrays', () => {
      expect(() => assertNonEmptyArray([1], 'test')).not.toThrow();
    });
    it('throws for empty array', () => {
      expect(() => assertNonEmptyArray([], 'test')).toThrow(EdApiError);
    });
    it('throws for non-array', () => {
      expect(() => assertNonEmptyArray('not an array', 'test')).toThrow(EdApiError);
    });
  });

  describe('assertNonNegativeInteger', () => {
    it('passes for 0 and positive integers', () => {
      expect(() => assertNonNegativeInteger(0, 'page')).not.toThrow();
      expect(() => assertNonNegativeInteger(7, 'page')).not.toThrow();
    });
    it('throws for negatives, fractions and non-numbers', () => {
      for (const bad of [-1, -0.5, 1.5, NaN, Infinity, '1', null]) {
        expect(() => assertNonNegativeInteger(bad, 'page')).toThrow(EdApiError);
      }
    });
    it('names the argument and echoes the value', () => {
      expect(() => assertNonNegativeInteger(-1, 'page')).toThrow('page must be an integer >= 0');
    });
  });

  describe('assertIntegerInRange', () => {
    it('passes for both bounds and values between them', () => {
      expect(() => assertIntegerInRange(1, 'depth', 1, 10)).not.toThrow();
      expect(() => assertIntegerInRange(10, 'depth', 1, 10)).not.toThrow();
      expect(() => assertIntegerInRange(5, 'depth', 1, 10)).not.toThrow();
    });
    it('throws outside the bounds, on fractions and on non-numbers', () => {
      for (const bad of [0, 11, -1, 5.5, NaN, '5', null]) {
        expect(() => assertIntegerInRange(bad, 'depth', 1, 10)).toThrow(EdApiError);
      }
    });
  });

  describe('assertValidDate', () => {
    it('passes for ISO strings, Date objects and timestamps', () => {
      expect(() => assertValidDate('2026-03-16', 'date')).not.toThrow();
      expect(() => assertValidDate('2026-03-16T08:30:00', 'date')).not.toThrow();
      expect(() => assertValidDate(new Date(), 'date')).not.toThrow();
      expect(() => assertValidDate(1_800_000_000_000, 'date')).not.toThrow();
    });
    it('throws for unparseable dates', () => {
      for (const bad of ['not-a-date', '', null, undefined, {}, true]) {
        expect(() => assertValidDate(bad, 'date')).toThrow(EdApiError);
      }
    });
    it('rolls out-of-range components over instead of rejecting them', () => {
      // `dayjs` is lenient here, matching what both callers did before: the value is
      // normalised to a real day rather than refused.
      expect(() => assertValidDate('2026-13-45', 'date')).not.toThrow();
    });
    it('reports the argument name and echoes the value', () => {
      expect(() => assertValidDate('nope', 'startDate')).toThrow(
        'startDate must be a valid date, got "nope"',
      );
    });
  });
});
// © 2026 typeof (Scolup) | Licensed under AGPL 3.
