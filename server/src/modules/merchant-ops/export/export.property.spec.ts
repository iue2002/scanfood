/**
 * Feature: merchant-ops-center, Property 13/14: Export invariants
 * Validates: Requirements 11.2, 11.7, 12.8
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { ExportCore } from './export.core';

const NINETY_TWO_DAYS_MS = 92 * 24 * 60 * 60 * 1000;

// ============================================================
// Property 13: 导出区间约束
// ============================================================
describe('Feature: merchant-ops-center, Property 13: ExportCore range constraint (≤ 92 days)', () => {
  it('accepts iff start < end AND end - start ≤ 92 days', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31'), noInvalidDate: true }),
        fc.integer({ min: -180 * 24 * 60 * 60 * 1000, max: 180 * 24 * 60 * 60 * 1000 }),
        (start, deltaMs) => {
          const end = new Date(start.getTime() + deltaMs);
          const result = ExportCore.validateOrderRange(start, end);
          const valid = deltaMs > 0 && deltaMs <= NINETY_TWO_DAYS_MS;
          if (valid) return result.ok === true;
          return result.ok === false && result.code === 'RANGE_INVALID';
        },
      ),
      { numRuns: 200 },
    );
  });

  it('rejects equal timestamps', () => {
    const t = new Date('2025-06-01');
    expect(ExportCore.validateOrderRange(t, t).ok).toBe(false);
  });

  it('accepts exactly 92 days', () => {
    const start = new Date('2025-01-01T00:00:00Z');
    const end = new Date(start.getTime() + NINETY_TWO_DAYS_MS);
    expect(ExportCore.validateOrderRange(start, end)).toEqual({ ok: true });
  });

  it('rejects > 92 days by 1ms', () => {
    const start = new Date('2025-01-01T00:00:00Z');
    const end = new Date(start.getTime() + NINETY_TWO_DAYS_MS + 1);
    expect(ExportCore.validateOrderRange(start, end).ok).toBe(false);
  });

  it('rejects invalid Date inputs', () => {
    const t = new Date();
    expect(ExportCore.validateOrderRange(new Date('invalid'), t).ok).toBe(false);
    expect(ExportCore.validateOrderRange(t, new Date('invalid')).ok).toBe(false);
  });
});

// ============================================================
// Property 14: 导出 audit payload 不含明细
// ============================================================
describe('Feature: merchant-ops-center, Property 14: export audit payload contains only allowed keys', () => {
  // 禁词集
  const FORBIDDEN_DETAIL_KEYS = ['dish_name', 'spec_name', 'subtotal', 'order_items', 'refund_reason'];

  it('EXPORT_ORDERS payload only has {startAt, endAt, rowCount, jobId} keys, no detail field names', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31'), noInvalidDate: true }),
        fc.integer({ min: 1, max: 92 * 24 * 60 * 60 * 1000 }),
        fc.integer({ min: 0, max: 100_000 }),
        fc.option(fc.uuid(), { nil: null }),
        (start, deltaMs, rowCount, jobId) => {
          const end = new Date(start.getTime() + deltaMs);
          const payload = ExportCore.buildOrdersAuditPayload({
            startAt: start.toISOString(),
            endAt: end.toISOString(),
            rowCount,
            jobId,
          });
          // 1) 仅含允许键
          const keys = Object.keys(payload).sort();
          if (JSON.stringify(keys) !== JSON.stringify(['endAt', 'jobId', 'rowCount', 'startAt'])) {
            return false;
          }
          // 2) 序列化后不含禁词（含作为 key 形式 "dish_name"）
          const json = JSON.stringify(payload);
          return FORBIDDEN_DETAIL_KEYS.every((banned) => !json.includes(`"${banned}"`));
        },
      ),
      { numRuns: 200 },
    );
  });

  it('EXPORT_REPORT payload only has {type, date, rowCount}', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<'DAILY' | 'MONTHLY'>('DAILY', 'MONTHLY'),
        fc.constantFrom('2025-01-15', '2024-12-31', '2026-02-29', '2025-06', '2024-12'),
        fc.integer({ min: 0, max: 100_000 }),
        (type, date, rowCount) => {
          const payload = ExportCore.buildReportAuditPayload({ type, date, rowCount });
          const keys = Object.keys(payload).sort();
          if (JSON.stringify(keys) !== JSON.stringify(['date', 'rowCount', 'type'])) return false;
          const json = JSON.stringify(payload);
          return FORBIDDEN_DETAIL_KEYS.every((banned) => !json.includes(`"${banned}"`));
        },
      ),
      { numRuns: 100 },
    );
  });

  it('assertAuditPayloadShape throws on extra keys (defensive guard)', () => {
    expect(() =>
      ExportCore.assertAuditPayloadShape(
        { startAt: 'a', endAt: 'b', rowCount: 1, jobId: 'x', extra: 'oops' as any },
        ['startAt', 'endAt', 'rowCount', 'jobId'],
      ),
    ).toThrow(/forbidden key/);
  });

  it('assertAuditPayloadShape throws when forbidden detail key appears as a key in payload', () => {
    expect(() =>
      ExportCore.assertAuditPayloadShape(
        // 这里把 dish_name 作为 key（非法），即使值合法也要被阻止
        { startAt: 'a', endAt: 'b', rowCount: 1, jobId: 'x', dish_name: 'foo' as any },
        ['startAt', 'endAt', 'rowCount', 'jobId'],
      ),
    ).toThrow();
  });

  it('isValidReportDate matches YYYY-MM-DD for DAILY and YYYY-MM for MONTHLY', () => {
    expect(ExportCore.isValidReportDate('DAILY', '2025-06-15')).toBe(true);
    expect(ExportCore.isValidReportDate('DAILY', '2025-06')).toBe(false);
    expect(ExportCore.isValidReportDate('DAILY', '2025-13-01')).toBe(false);
    expect(ExportCore.isValidReportDate('MONTHLY', '2025-06')).toBe(true);
    expect(ExportCore.isValidReportDate('MONTHLY', '2025-06-15')).toBe(false);
    expect(ExportCore.isValidReportDate('MONTHLY', '20-06')).toBe(false);
  });
});
