/**
 * 打印方案 Repo 的 Drizzle 实现
 *
 * 核心要点：
 *  - 默认位互斥：upsert 时同事务先清旧默认
 *  - 系统默认 plan（id=1）保护：不能删 / enabled / is_system_default 不允许动
 *  - slice 全量替换策略：updatePlan 删旧 slice 重建，避免脏数据
 */
import { Injectable, Logger } from '@nestjs/common';
import { db } from '@/storage/database/mysql-client';
import { print_plans, print_plan_slices } from '@/storage/database/shared/schema';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { PrintPlanRepoPort } from './plan-repo.port';
import type {
  PrintPlanRow,
  PrintPlanSliceRow,
  PrintPlanWithSlices,
  PrintPlanUpsertDto,
  PrinterRole,
} from './print.types';
import { SYSTEM_DEFAULT_PLAN_ID } from './print.types';

@Injectable()
export class DrizzlePrintPlanRepo implements PrintPlanRepoPort {
  private readonly logger = new Logger(DrizzlePrintPlanRepo.name);

  // ============================================================
  // 投影
  // ============================================================
  private toPlan(r: any): PrintPlanRow {
    return {
      id: r.id,
      name: r.name,
      enabled: !!r.enabled,
      is_default_dine_in: !!r.is_default_dine_in,
      is_default_takeaway: !!r.is_default_takeaway,
      is_system_default: !!r.is_system_default,
      description: r.description ?? null,
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  }

  private toSlice(r: any): PrintPlanSliceRow {
    let cats: number[] | null = null;
    if (r.category_ids != null) {
      if (Array.isArray(r.category_ids)) {
        cats = r.category_ids.filter((x: any) => Number.isInteger(x)) as number[];
      } else if (typeof r.category_ids === 'string') {
        try {
          const parsed = JSON.parse(r.category_ids);
          if (Array.isArray(parsed)) cats = parsed.filter((x: any) => Number.isInteger(x)) as number[];
        } catch { /* keep null */ }
      }
    }
    return {
      id: r.id,
      plan_id: r.plan_id,
      printer_id: r.printer_id,
      template_id: r.template_id ?? null,
      printer_role_snapshot: (r.printer_role_snapshot ?? 'BOTH') as PrinterRole,
      category_ids: cats,
      label: r.label ?? '',
      sort_order: r.sort_order ?? 0,
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  }

  private async loadSlices(planIds: number[]): Promise<Map<number, PrintPlanSliceRow[]>> {
    const map = new Map<number, PrintPlanSliceRow[]>();
    if (planIds.length === 0) return map;
    const rows = await db
      .select()
      .from(print_plan_slices)
      .where(inArray(print_plan_slices.plan_id, planIds))
      .orderBy(asc(print_plan_slices.sort_order), asc(print_plan_slices.id));
    for (const r of rows) {
      const s = this.toSlice(r);
      const arr = map.get(s.plan_id) ?? [];
      arr.push(s);
      map.set(s.plan_id, arr);
    }
    return map;
  }

  // ============================================================
  // 查询
  // ============================================================
  async listPlans(includeDisabled = true): Promise<PrintPlanWithSlices[]> {
    const where = includeDisabled ? undefined : eq(print_plans.enabled, true);
    const rows = await db
      .select()
      .from(print_plans)
      .where(where as any)
      .orderBy(asc(print_plans.id));
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const slicesMap = await this.loadSlices(ids);
    return rows.map((r) => ({ ...this.toPlan(r), slices: slicesMap.get(r.id) ?? [] }));
  }

  async findPlanById(id: number): Promise<PrintPlanWithSlices | null> {
    const rows = await db.select().from(print_plans).where(eq(print_plans.id, id)).limit(1);
    if (rows.length === 0) return null;
    const slicesMap = await this.loadSlices([id]);
    return { ...this.toPlan(rows[0]), slices: slicesMap.get(id) ?? [] };
  }

  async findDefaultPlan(orderType: 'dine_in' | 'takeaway'): Promise<PrintPlanWithSlices | null> {
    const cond = orderType === 'takeaway' ? print_plans.is_default_takeaway : print_plans.is_default_dine_in;
    const rows = await db
      .select()
      .from(print_plans)
      .where(and(eq(cond, true), eq(print_plans.enabled, true)))
      .limit(1);
    if (rows.length === 0) return null;
    const slicesMap = await this.loadSlices([rows[0].id]);
    return { ...this.toPlan(rows[0]), slices: slicesMap.get(rows[0].id) ?? [] };
  }

  async getSystemDefaultPlan(): Promise<PrintPlanWithSlices> {
    const p = await this.findPlanById(SYSTEM_DEFAULT_PLAN_ID);
    if (!p) throw new Error('system default plan (id=1) missing — please run migration 0011');
    return p;
  }

  // ============================================================
  // 写
  // ============================================================
  async insertPlan(dto: PrintPlanUpsertDto): Promise<PrintPlanWithSlices> {
    return await db.transaction(async (tx) => {
      // 1) 清旧默认位
      if (dto.is_default_dine_in) {
        await tx.update(print_plans).set({ is_default_dine_in: false }).where(eq(print_plans.is_default_dine_in, true));
      }
      if (dto.is_default_takeaway) {
        await tx.update(print_plans).set({ is_default_takeaway: false }).where(eq(print_plans.is_default_takeaway, true));
      }
      // 2) 插入 plan
      const r: any = await tx.insert(print_plans).values({
        name: dto.name,
        enabled: dto.enabled ?? true,
        is_default_dine_in: !!dto.is_default_dine_in,
        is_default_takeaway: !!dto.is_default_takeaway,
        is_system_default: false,
        description: dto.description ?? null,
      });
      const planId = (r as any)?.[0]?.insertId ?? (r as any)?.insertId;
      // 3) 插入 slices
      if (dto.slices.length > 0) {
        await tx.insert(print_plan_slices).values(dto.slices.map((s, idx) => ({
          plan_id: planId,
          printer_id: s.printer_id,
          template_id: s.template_id ?? null,
          printer_role_snapshot: s.printer_role_snapshot ?? 'BOTH',
          category_ids: (s.category_ids && s.category_ids.length > 0 ? s.category_ids : null) as any,
          label: s.label ?? '',
          sort_order: s.sort_order ?? idx,
        })));
      }
      return planId;
    }).then(async (planId) => {
      const fresh = await this.findPlanById(planId as number);
      if (!fresh) throw new Error('insertPlan: plan not found after insert');
      return fresh;
    });
  }

  async updatePlan(id: number, dto: PrintPlanUpsertDto): Promise<PrintPlanWithSlices> {
    return await db.transaction(async (tx) => {
      const existing = await tx.select().from(print_plans).where(eq(print_plans.id, id)).limit(1);
      if (existing.length === 0) throw new Error(`plan ${id} not found`);
      const isSystem = !!existing[0].is_system_default;

      // 系统默认 plan：不允许 disable / 改 default 标记
      const enabledNext = isSystem ? true : (dto.enabled ?? !!existing[0].enabled);

      // 默认位互斥
      if (dto.is_default_dine_in) {
        await tx.update(print_plans).set({ is_default_dine_in: false }).where(and(eq(print_plans.is_default_dine_in, true), ne(print_plans.id, id)));
      }
      if (dto.is_default_takeaway) {
        await tx.update(print_plans).set({ is_default_takeaway: false }).where(and(eq(print_plans.is_default_takeaway, true), ne(print_plans.id, id)));
      }

      await tx.update(print_plans).set({
        name: dto.name,
        enabled: enabledNext,
        is_default_dine_in: dto.is_default_dine_in ?? !!existing[0].is_default_dine_in,
        is_default_takeaway: dto.is_default_takeaway ?? !!existing[0].is_default_takeaway,
        description: dto.description ?? null,
      }).where(eq(print_plans.id, id));

      // slices 全量替换
      await tx.delete(print_plan_slices).where(eq(print_plan_slices.plan_id, id));
      if (dto.slices.length > 0) {
        await tx.insert(print_plan_slices).values(dto.slices.map((s, idx) => ({
          plan_id: id,
          printer_id: s.printer_id,
          template_id: s.template_id ?? null,
          printer_role_snapshot: s.printer_role_snapshot ?? 'BOTH',
          category_ids: (s.category_ids && s.category_ids.length > 0 ? s.category_ids : null) as any,
          label: s.label ?? '',
          sort_order: s.sort_order ?? idx,
        })));
      }
      return id;
    }).then(async () => {
      const fresh = await this.findPlanById(id);
      if (!fresh) throw new Error('updatePlan: plan not found after update');
      return fresh;
    });
  }

  async deletePlan(id: number): Promise<void> {
    if (id === SYSTEM_DEFAULT_PLAN_ID) {
      throw new Error('PLAN_PROTECTED: 系统默认方案不可删');
    }
    await db.delete(print_plans).where(eq(print_plans.id, id));
    // slices 通过 ON DELETE CASCADE 自动清理
  }

  // ============================================================
  // 跨方案治理（分类删除联动）
  // ============================================================
  async removeCategoryFromAllSlices(categoryId: number): Promise<number> {
    // MySQL 8: JSON_REMOVE / JSON_SEARCH
    // 由于 Drizzle 不直接支持 JSON 操作，这里用纯 SQL（参数化）
    // 思路：扫所有非 NULL category_ids 的 slice，把 categoryId 移除；变空就置 NULL
    const rows = await db
      .select({ id: print_plan_slices.id, category_ids: print_plan_slices.category_ids })
      .from(print_plan_slices)
      .where(sql`${print_plan_slices.category_ids} IS NOT NULL`);

    let affected = 0;
    for (const r of rows) {
      let arr: number[] = [];
      const raw: any = r.category_ids;
      if (Array.isArray(raw)) arr = raw.filter((x) => Number.isInteger(x)) as number[];
      else if (typeof raw === 'string') {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) arr = parsed.filter((x) => Number.isInteger(x)) as number[];
        } catch { continue; }
      }
      if (!arr.includes(categoryId)) continue;
      const next = arr.filter((x) => x !== categoryId);
      await db.update(print_plan_slices)
        .set({ category_ids: next.length > 0 ? (next as any) : null })
        .where(eq(print_plan_slices.id, r.id));
      affected += 1;
    }
    return affected;
  }

  async pruneOrphanCategoryRefs(validCategoryIds: ReadonlyArray<number>): Promise<{ slicesAffected: number; orphanIds: number[] }> {
    const validSet = new Set(validCategoryIds);
    const rows = await db
      .select({ id: print_plan_slices.id, category_ids: print_plan_slices.category_ids })
      .from(print_plan_slices)
      .where(sql`${print_plan_slices.category_ids} IS NOT NULL`);

    let slicesAffected = 0;
    const orphanSet = new Set<number>();
    for (const r of rows) {
      let arr: number[] = [];
      const raw: any = r.category_ids;
      if (Array.isArray(raw)) arr = raw.filter((x) => Number.isInteger(x)) as number[];
      else if (typeof raw === 'string') {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) arr = parsed.filter((x) => Number.isInteger(x)) as number[];
        } catch { continue; }
      }
      const next = arr.filter((id) => validSet.has(id));
      if (next.length === arr.length) continue;
      for (const id of arr) if (!validSet.has(id)) orphanSet.add(id);
      await db.update(print_plan_slices)
        .set({ category_ids: next.length > 0 ? (next as any) : null })
        .where(eq(print_plan_slices.id, r.id));
      slicesAffected += 1;
    }
    return { slicesAffected, orphanIds: Array.from(orphanSet) };
  }
}
