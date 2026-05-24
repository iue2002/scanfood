/**
 * Feature: merchant-ops-center, Property 26/27/28: PrintPlan invariants
 * Validates:
 *  - Property 26: onCategoryDeleted 后所有 slice 不再含该 id
 *  - Property 27: splitOrderByPlan 输出无遗漏（catch-all 时 uncovered=空；items 并集去重 ⊆ 输入）
 *  - Property 28: 默认 plan 业务唯一性（同 order_type 同时最多 1 个 enabled 默认）
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { PrintPlanCore } from './plan.core';
import type { PrintPlanRepoPort } from './plan-repo.port';
import type {
  OrderItemForSplit,
  PrintPlanRow,
  PrintPlanSliceRow,
  PrintPlanUpsertDto,
  PrintPlanWithSlices,
} from './print.types';

// ============================================================
// In-memory PrintPlanRepoPort stub
// ============================================================
class StubPlanRepo implements PrintPlanRepoPort {
  plans: PrintPlanWithSlices[] = [];
  private nextPlanId = 2; // id=1 reserved for system default
  private nextSliceId = 1;

  constructor(opts?: { withSystemDefault?: boolean }) {
    if (opts?.withSystemDefault) {
      const now = new Date();
      this.plans.push({
        id: 1,
        name: '系统默认 · 整单全票',
        enabled: true,
        is_default_dine_in: true,
        is_default_takeaway: true,
        is_system_default: true,
        description: null,
        slices: [],
        created_at: now,
        updated_at: now,
      });
    }
  }

  async listPlans(includeDisabled = true): Promise<PrintPlanWithSlices[]> {
    return includeDisabled ? [...this.plans] : this.plans.filter((p) => p.enabled);
  }
  async findPlanById(id: number): Promise<PrintPlanWithSlices | null> {
    return this.plans.find((p) => p.id === id) ?? null;
  }
  async findDefaultPlan(orderType: 'dine_in' | 'takeaway'): Promise<PrintPlanWithSlices | null> {
    return this.plans.find((p) => p.enabled && (orderType === 'takeaway' ? p.is_default_takeaway : p.is_default_dine_in)) ?? null;
  }
  async getSystemDefaultPlan(): Promise<PrintPlanWithSlices> {
    const p = await this.findPlanById(1);
    if (!p) throw new Error('system default plan missing');
    return p;
  }
  async insertPlan(dto: PrintPlanUpsertDto): Promise<PrintPlanWithSlices> {
    if (dto.is_default_dine_in) for (const p of this.plans) p.is_default_dine_in = false;
    if (dto.is_default_takeaway) for (const p of this.plans) p.is_default_takeaway = false;
    const now = new Date();
    const id = this.nextPlanId++;
    const slices: PrintPlanSliceRow[] = dto.slices.map((s, idx) => ({
      id: this.nextSliceId++,
      plan_id: id,
      printer_id: s.printer_id,
      template_id: s.template_id ?? null,
      printer_role_snapshot: s.printer_role_snapshot ?? 'BOTH',
      category_ids: s.category_ids && s.category_ids.length > 0 ? [...s.category_ids] : null,
      label: s.label ?? '',
      sort_order: s.sort_order ?? idx,
      created_at: now,
      updated_at: now,
    }));
    const plan: PrintPlanWithSlices = {
      id,
      name: dto.name,
      enabled: dto.enabled ?? true,
      is_default_dine_in: !!dto.is_default_dine_in,
      is_default_takeaway: !!dto.is_default_takeaway,
      is_system_default: false,
      description: dto.description ?? null,
      slices,
      created_at: now,
      updated_at: now,
    };
    this.plans.push(plan);
    return plan;
  }
  async updatePlan(id: number, dto: PrintPlanUpsertDto): Promise<PrintPlanWithSlices> {
    const i = this.plans.findIndex((p) => p.id === id);
    if (i < 0) throw new Error('plan not found');
    if (dto.is_default_dine_in) for (const p of this.plans) if (p.id !== id) p.is_default_dine_in = false;
    if (dto.is_default_takeaway) for (const p of this.plans) if (p.id !== id) p.is_default_takeaway = false;
    const now = new Date();
    const isSystem = this.plans[i].is_system_default;
    const slices: PrintPlanSliceRow[] = dto.slices.map((s, idx) => ({
      id: this.nextSliceId++,
      plan_id: id,
      printer_id: s.printer_id,
      template_id: s.template_id ?? null,
      printer_role_snapshot: s.printer_role_snapshot ?? 'BOTH',
      category_ids: s.category_ids && s.category_ids.length > 0 ? [...s.category_ids] : null,
      label: s.label ?? '',
      sort_order: s.sort_order ?? idx,
      created_at: now,
      updated_at: now,
    }));
    this.plans[i] = {
      ...this.plans[i],
      name: dto.name,
      enabled: isSystem ? true : (dto.enabled ?? this.plans[i].enabled),
      is_default_dine_in: dto.is_default_dine_in ?? this.plans[i].is_default_dine_in,
      is_default_takeaway: dto.is_default_takeaway ?? this.plans[i].is_default_takeaway,
      description: dto.description ?? null,
      slices,
      updated_at: now,
    };
    return this.plans[i];
  }
  async deletePlan(id: number): Promise<void> {
    if (id === 1) throw new Error('PLAN_PROTECTED');
    this.plans = this.plans.filter((p) => p.id !== id);
  }
  async removeCategoryFromAllSlices(categoryId: number): Promise<number> {
    let affected = 0;
    for (const p of this.plans) {
      for (const s of p.slices) {
        if (!s.category_ids) continue;
        if (!s.category_ids.includes(categoryId)) continue;
        const next = s.category_ids.filter((id) => id !== categoryId);
        s.category_ids = next.length > 0 ? next : null;
        affected += 1;
      }
    }
    return affected;
  }
  async pruneOrphanCategoryRefs(validCategoryIds: ReadonlyArray<number>): Promise<{ slicesAffected: number; orphanIds: number[] }> {
    const valid = new Set(validCategoryIds);
    let slicesAffected = 0;
    const orphanSet = new Set<number>();
    for (const p of this.plans) {
      for (const s of p.slices) {
        if (!s.category_ids) continue;
        const next = s.category_ids.filter((id) => valid.has(id));
        if (next.length === s.category_ids.length) continue;
        for (const id of s.category_ids) if (!valid.has(id)) orphanSet.add(id);
        s.category_ids = next.length > 0 ? next : null;
        slicesAffected += 1;
      }
    }
    return { slicesAffected, orphanIds: Array.from(orphanSet) };
  }
}

// Stub printer repo（仅用 listPrinters）
const stubPrinterRepo = {
  async listPrinters() {
    // 提供 1..10 号 printer
    return Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      name: `printer ${i + 1}`,
      provider: 'FEIE' as const,
      device_sn: null,
      role: 'BOTH' as const,
      enabled: true,
      auto_print: false,
      auto_print_add_more: false,
      template_id: null,
      last_online_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    }));
  },
} as any;

// ============================================================
// 公共 Arbitraries
// ============================================================
const arbCategoryId = fc.integer({ min: 1, max: 20 });
const arbPrinterId = fc.integer({ min: 1, max: 10 });

const arbSlice = fc.record({
  printer_id: arbPrinterId,
  template_id: fc.option(fc.integer({ min: 1, max: 5 }), { nil: null }),
  category_ids: fc.option(fc.uniqueArray(arbCategoryId, { minLength: 0, maxLength: 5 }), { nil: null }),
  label: fc.string({ minLength: 0, maxLength: 20 }),
  sort_order: fc.integer({ min: 0, max: 100 }),
});

const arbPlanDto = fc.record({
  name: fc.string({ minLength: 1, maxLength: 50 }).map((s) => s.trim() || 'plan'),
  enabled: fc.boolean(),
  is_default_dine_in: fc.boolean(),
  is_default_takeaway: fc.boolean(),
  description: fc.option(fc.string({ maxLength: 100 }), { nil: null }),
  slices: fc.array(arbSlice, { minLength: 1, maxLength: 10 }),
});

const arbOrderItem = fc.record({
  order_item_id: fc.integer({ min: 1, max: 1000 }),
  category_id: arbCategoryId,
  name: fc.string({ minLength: 1, maxLength: 20 }),
  spec: fc.option(fc.string({ maxLength: 10 }), { nil: null }),
  quantity: fc.integer({ min: 1, max: 5 }),
  subtotal: fc.float({ min: Math.fround(0), max: Math.fround(10000), noNaN: true }),
});

// ============================================================
// Property 26：onCategoryDeleted → 全部 slice 不再含该 id
// ============================================================
describe('Feature: merchant-ops-center, Property 26: onCategoryDeleted removes all references', () => {
  it('after onCategoryDeleted(catId), no slice in any plan contains catId', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbPlanDto, { minLength: 1, maxLength: 5 }),
        arbCategoryId,
        async (planDtos, catId) => {
          const repo = new StubPlanRepo();
          const core = new PrintPlanCore(repo, stubPrinterRepo);
          // 先把 dtos 全部插入（先把 catId 强行加进每个 dto 的某些 slice，制造引用）
          for (const dto of planDtos) {
            // 确保 dto.slices[0] 引用 catId
            if (dto.slices.length > 0) {
              const s0 = dto.slices[0];
              const cats = (s0.category_ids ?? []).slice();
              if (!cats.includes(catId)) cats.push(catId);
              s0.category_ids = cats;
            }
            try { await core.createPlan(dto); } catch { /* 验证失败的 dto 跳过 */ }
          }
          // 触发清理
          await core.onCategoryDeleted(catId);
          // 校验：所有 slice 的 category_ids 都不含 catId
          const all = await core.listPlans();
          for (const plan of all) {
            for (const slice of plan.slices) {
              if (slice.category_ids) {
                expect(slice.category_ids.includes(catId)).toBe(false);
              }
            }
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it('repeated random create+delete sequence: after every deleteCat, invariant holds at that moment', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.oneof(
            fc.record({ kind: fc.constant('create' as const), dto: arbPlanDto }),
            fc.record({ kind: fc.constant('deleteCat' as const), catId: arbCategoryId }),
          ),
          { minLength: 1, maxLength: 30 },
        ),
        async (ops) => {
          const repo = new StubPlanRepo();
          const core = new PrintPlanCore(repo, stubPrinterRepo);
          for (const op of ops) {
            if (op.kind === 'create') {
              try { await core.createPlan(op.dto); } catch { /* skip invalid */ }
            } else {
              await core.onCategoryDeleted(op.catId);
              // 删除后立即校验：当前没有 slice 引用 op.catId
              const all = await core.listPlans();
              for (const plan of all) {
                for (const slice of plan.slices) {
                  if (!slice.category_ids) continue;
                  expect(slice.category_ids.includes(op.catId)).toBe(false);
                }
              }
            }
          }
        },
      ),
      { numRuns: 30 },
    );
  });
});

// ============================================================
// Property 27：splitOrderByPlan 输出无遗漏 / 子集
// ============================================================
describe('Feature: merchant-ops-center, Property 27: splitOrderByPlan no-loss', () => {
  it('union of dispatched item ids ⊆ input item ids (no duplicates per dispatch)', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(arbOrderItem, { selector: (i: OrderItemForSplit) => i.order_item_id, minLength: 1, maxLength: 20 }),
        fc.array(arbSlice, { minLength: 1, maxLength: 8 }),
        (items, sliceConfigs) => {
          const plan: PrintPlanWithSlices = {
            id: 99,
            name: 'test',
            enabled: true,
            is_default_dine_in: false,
            is_default_takeaway: false,
            is_system_default: false,
            description: null,
            slices: sliceConfigs.map((s, idx) => ({
              id: idx + 1,
              plan_id: 99,
              printer_id: s.printer_id,
              template_id: s.template_id ?? null,
              printer_role_snapshot: 'BOTH',
              category_ids: s.category_ids && s.category_ids.length > 0 ? s.category_ids : null,
              label: s.label,
              sort_order: s.sort_order,
              created_at: new Date(),
              updated_at: new Date(),
            })),
            created_at: new Date(),
            updated_at: new Date(),
          };
          const r = PrintPlanCore.splitOrderByPlan(plan, items);
          const inputIds = new Set(items.map((i) => i.order_item_id));
          // 1) 每个 dispatch 内部不重复
          for (const d of r.dispatches) {
            const ids = d.items.map((it) => it.order_item_id);
            expect(new Set(ids).size).toBe(ids.length);
            // 2) 每个 dispatched id 来自 input
            for (const id of ids) expect(inputIds.has(id)).toBe(true);
          }
          // 3) uncovered 也都来自 input
          for (const u of r.uncovered) expect(inputIds.has(u.order_item_id)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('with catch-all slice, uncovered is always empty', () => {
    // 具体切片 arbitrary：category_ids 强制非空（避免成 catch-all）
    const arbSpecificSlice = fc.record({
      printer_id: arbPrinterId,
      template_id: fc.option(fc.integer({ min: 1, max: 5 }), { nil: null }),
      category_ids: fc.uniqueArray(arbCategoryId, { minLength: 1, maxLength: 3 }),
      label: fc.string({ minLength: 0, maxLength: 20 }),
      sort_order: fc.integer({ min: 0, max: 100 }),
    });
    fc.assert(
      fc.property(
        fc.uniqueArray(arbOrderItem, { selector: (i: OrderItemForSplit) => i.order_item_id, minLength: 1, maxLength: 15 }),
        fc.array(arbSpecificSlice, { minLength: 0, maxLength: 5 }),
        arbPrinterId,
        (items, specificSlices, catchAllPrinterId) => {
          const slices: PrintPlanSliceRow[] = [
            ...specificSlices.map((s, idx) => ({
              id: idx + 1,
              plan_id: 99,
              printer_id: s.printer_id,
              template_id: s.template_id ?? null,
              printer_role_snapshot: 'BOTH' as const,
              category_ids: s.category_ids,
              label: s.label,
              sort_order: s.sort_order,
              created_at: new Date(),
              updated_at: new Date(),
            })),
            // catch-all
            {
              id: 9999,
              plan_id: 99,
              printer_id: catchAllPrinterId,
              template_id: null,
              printer_role_snapshot: 'BOTH' as const,
              category_ids: null,
              label: '兜底',
              sort_order: 9999,
              created_at: new Date(),
              updated_at: new Date(),
            },
          ];
          const plan: PrintPlanWithSlices = {
            id: 99,
            name: 'test',
            enabled: true,
            is_default_dine_in: false,
            is_default_takeaway: false,
            is_system_default: false,
            description: null,
            slices,
            created_at: new Date(),
            updated_at: new Date(),
          };
          const r = PrintPlanCore.splitOrderByPlan(plan, items);
          expect(r.uncovered.length).toBe(0);
          // 输出 dispatches 的 items 并集应该 ⊇ 输入 items
          const dispatched = new Set<number>();
          for (const d of r.dispatches) for (const it of d.items) dispatched.add(it.order_item_id);
          for (const it of items) expect(dispatched.has(it.order_item_id)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ============================================================
// Property 28：默认 plan 业务唯一性
// ============================================================
describe('Feature: merchant-ops-center, Property 28: default plan uniqueness per order_type', () => {
  it('after any sequence of create/update, at most 1 enabled default per order_type', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbPlanDto, { minLength: 1, maxLength: 10 }),
        async (dtos) => {
          const repo = new StubPlanRepo({ withSystemDefault: false });
          const core = new PrintPlanCore(repo, stubPrinterRepo);
          for (const dto of dtos) {
            try { await core.createPlan(dto); } catch { /* skip invalid */ }
          }
          const all = await core.listPlans();
          const dineIn = all.filter((p) => p.enabled && p.is_default_dine_in).length;
          const takeaway = all.filter((p) => p.enabled && p.is_default_takeaway).length;
          expect(dineIn).toBeLessThanOrEqual(1);
          expect(takeaway).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('with system default + N user plans, default count never exceeds 1', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbPlanDto, { minLength: 0, maxLength: 5 }),
        async (dtos) => {
          const repo = new StubPlanRepo({ withSystemDefault: true });
          const core = new PrintPlanCore(repo, stubPrinterRepo);
          for (const dto of dtos) {
            try { await core.createPlan(dto); } catch { /* skip invalid */ }
          }
          const all = await core.listPlans();
          const dineIn = all.filter((p) => p.enabled && p.is_default_dine_in).length;
          const takeaway = all.filter((p) => p.enabled && p.is_default_takeaway).length;
          expect(dineIn).toBeLessThanOrEqual(1);
          expect(takeaway).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 50 },
    );
  });
});
