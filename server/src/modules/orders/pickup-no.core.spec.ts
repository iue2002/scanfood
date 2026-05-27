import { describe, it, expect } from 'vitest';
import { computeBizDate } from './pickup-no.core';

describe('computeBizDate', () => {
  it('reset 00:00 uses same calendar date', () => {
    const d = new Date('2026-05-27T10:15:00');
    expect(computeBizDate(d, '00:00')).toBe('2026-05-27');
  });

  it('reset 04:00 treats before 04:00 as previous day', () => {
    const before = new Date('2026-05-27T03:59:00');
    const after = new Date('2026-05-27T04:00:00');
    expect(computeBizDate(before, '04:00')).toBe('2026-05-26');
    expect(computeBizDate(after, '04:00')).toBe('2026-05-27');
  });
});
