// © 2026 typeof (Scolup) | Licensed under AGPL 3.0
import { EdValidationError } from './errors';
import dayjs from 'dayjs';

export function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new EdValidationError(
      `${name} must be a non-empty string, got ${typeof value}`,
      'INVALID_ARGUMENT',
    );
  }
}

export function assertPositiveNumber(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new EdValidationError(
      `${name} must be a positive number, got ${JSON.stringify(value)}`,
      'INVALID_ARGUMENT',
    );
  }
}

export function assertPositiveInteger(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new EdValidationError(
      `${name} must be a positive integer, got ${JSON.stringify(value)}`,
      'INVALID_ARGUMENT',
    );
  }
}

export function assertNonEmptyArray(value: unknown, name: string): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new EdValidationError(
      `${name} must be a non-empty array, got ${JSON.stringify(value)}`,
      'INVALID_ARGUMENT',
    );
  }
}

export function assertIntegerInRange(
  value: unknown,
  name: string,
  min: number,
  max: number,
): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new EdValidationError(
      `${name} must be an integer between ${min} and ${max}, got ${JSON.stringify(value)}`,
      'INVALID_ARGUMENT',
    );
  }
}

export function assertNonNegativeInteger(value: unknown, name: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new EdValidationError(
      `${name} must be an integer >= 0, got ${JSON.stringify(value)}`,
      'INVALID_ARGUMENT',
    );
  }
}

export function assertValidDate(value: unknown, name: string): void {
  // `dayjs(undefined)` resolves to "now" and `dayjs('2026-13-45')` rolls over to a
  // valid date, so leniency alone would let garbage through as a plausible day.
  if (typeof value !== 'string' && !(value instanceof Date) && typeof value !== 'number') {
    throw new EdValidationError(
      `${name} must be a valid date, got ${JSON.stringify(value) ?? String(value)}`,
      'INVALID_ARGUMENT',
    );
  }
  if (!dayjs(value).isValid()) {
    throw new EdValidationError(
      `${name} must be a valid date, got ${JSON.stringify(value)}`,
      'INVALID_ARGUMENT',
    );
  }
}
