/**
 * PrintPlanCore：高度定制化打印方案的领域核心
 *
 * 职责：
 *  1. 验证 plan 配置（有效性、最少 slice、catch-all 提示）
 *  2. 把订单按 plan 拆成多张票（splitOrder）
 *  3. 兜底：分类未被任何 slice 覆盖时，落到 catch-all；catch-all 不存在时返回 uncovered 警告
 *  4. 业务方法：CRUD plan、按订单类型选默认 plan、级联清理删除分类
 *
 * 静态方法（PBT 友好）：
 *  - validatePlanInput
 *  - splitOrderByPlan  → Property 27（无遗漏 / 兜底）
 *  - countDefaultsAfter → Property 28（默认唯一性）
 */
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { PrintPlanRepoPort } from './plan-repo.port';
import type { PrintRepoPort } from './print-repo.port';
import type {
  OrderItemForSplit,
  PlanDispatchResult,
  PrintPlanRow,
  PrintPlanSliceRow,
  PrintPlanUpsertDto,
  PrintPlanWithSlices,
  PrinterRole,
} from './print.types';
import { SYSTEM_DEFAULT_PLAN_ID } from './print.types';

/** 防止 plan 配置过大：slices 数量上限 */
export const MAX_SLICES_PER_PLAN = 20;

@Injectable()
export class PrintPlanCore {
  private readonly logger = new Logger(PrintPlanCore.name);

  constructor(
    private readonly planRepo: PrintPlanRepoPort,
    private readonly printerRepo: PrintRepoPort,
  ) {}

  // ============================================================
  // 静态规则
  // ============================================================

  /**
   * 验证 PrintPlanUpsertDto
   * 不变量：
   *  - name 非空 / ≤100 字
   *  - slices 数量 ∈ [1, MAX_SLICES_PER_PLAN]
   *  - 每个 slice.printer_id 是正整数
   *  - 每个 slice.category_ids 是 null 或 int[] 且无重复
   *  - 同一个 plan 内：同一 printer_id 不能同时有"全 catch-all"和"具体分类"切片（避免歧义）
   */
  static validatePlanInput(dto: PrintPlanUpsertDto): { ok: true; normalized: PrintPlanUpsertDto } | { ok: false; code: 'PLAN_INVALID'; reason: string } {
    if (typeof dto !== 'object' || dto === null) return { ok: false, code: 'PLAN_INVALID', reason: 'payload 必须是对象' };
    if (typeof dto.name !== 'string' || dto.name.trim().length === 0 || dto.name.length > 100) {
      return { ok: false, code: 'PLAN_INVALID', reason: 'name 必须是 1~100 字非空字符串' };
    }
    if (!Array.isArray(dto.slices) || dto.slices.length === 0) {
      return { ok: false, code: 'PLAN_INVALID', reason: 'slices 至少要有 1 张票' };
    }
    if (dto.slices.length > MAX_SLICES_PER_PLAN) {
      return { ok: false, code: 'PLAN_INVALID', reason: `slices 最多 ${MAX_SLICES_PER_PLAN} 张票` };
    }

    const normalizedSlices: PrintPlanUpsertDto['slices'] = [];
    const printerCatchAllSet = new Map<number, boolean>(); // printer_id → 是否已有 catch-all 切片

    for (let i = 0; i < dto.slices.length; i++) {
      const s = dto.slices[i];
      if (!Number.isInteger(s.printer_id) || s.printer_id < 1) {
        return { ok: false, code: 'PLAN_INVALID', reason: `slice[${i}].printer_id 非法` };
      }
      let cats: number[] | null = null;
      if (s.category_ids !== null && s.category_ids !== undefined) {
        if (!Array.isArray(s.category_ids)) {
          return { ok: false, code: 'PLAN_INVALID', reason: `slice[${i}].category_ids 必须是 int[] 或 null` };
        }
        const dedup = new Set<number>();
        for (const c of s.category_ids) {
          if (!Number.isInteger(c) || c < 1) {
            return { ok: false, code: 'PLAN_INVALID', reason: `slice[${i}].category_ids 含非法 id` };
          }
          dedup.add(c);
        }
        cats = dedup.size > 0 ? Array.from(dedup).sort((a, b) => a - b) : null;
      }
      const isCatchAll = cats === null || cats.length === 0;
      const prev = printerCatchAllSet.get(s.printer_id);
      if (prev !== undefined && prev !== isCatchAll) {
        // 同一打印机一会 catch-all 一会具体分类 → 行为有歧义
        return { ok: false, code: 'PLAN_INVALID', reason: `slice[${i}]: 打印机 ${s.printer_id} 不能同时有 catch-all 和具体分类切片` };
      }
      printerCatchAllSet.set(s.printer_id, isCatchAll);

      normalizedSlices.push({
        printer_id: s.printer_id,
        template_id: s.template_id ?? null,
        printer_role_snapshot: s.printer_role_snapshot ?? 'BOTH',
        category_ids: cats,
        label: (s.label ?? '').slice(0, 100),
        sort_order: Number.isInteger(s.sort_order) ? (s.sort_order as number) : i,
      });
    }

    return {
      ok: true,
      normalized: {
        name: dto.name.trim(),
        enabled: dto.enabled ?? true,
        is_default_dine_in: !!dto.is_default_dine_in,
        is_default_takeaway: !!dto.is_default_takeaway,
        description: dto.description ?? null,
        slices: normalizedSlices,
      },
    };
  }

  /**
   * Property 27 / 核心算法：按 plan 把订单 items 拆成多张票
   *
   * 算法：
   *  - 对每个 slice：
   *    - catch-all (category_ids=null/[]) → 兜底切片，收**未被任何具体切片接收**的 items
   *    - 具体分类 → 收 category_id ∈ slice.category_ids 的 items（同一 item 可被多个具体切片同时收）
   *  - 同一 item 可以出现在多张票（业务上"酒水"既给烧烤档也给主食档是合法的）
   *  - 兜底：未被任何切片接收的 items（既不在具体切片，也无 catch-all） → 进入 uncovered
   *
   * 不变量（PBT）：
   *  - 输出 dispatches 的 items 并集（去重）⊆ 输入 items
   *  - 当存在 catch-all 切片时，uncovered 始终为空（绝不漏打）
   */
  static splitOrderByPlan(
    plan: PrintPlanWithSlices,
    items: OrderItemForSplit[],
  ): { dispatches: PlanDispatchResult[]; uncovered: OrderItemForSplit[] } {
    const dispatches: PlanDispatchResult[] = [];
    const coveredByExplicit = new Set<number>(); // order_item_id 集合
    const slices = [...plan.slices].sort((a, b) => a.sort_order - b.sort_order);

    // 第一遍：处理具体分类切片
    for (const s of slices) {
      const isCatchAll = !s.category_ids || s.category_ids.length === 0;
      if (isCatchAll) continue;
      const catSet = new Set<number>(s.category_ids!);
      const sliceItems = items.filter((it) => catSet.has(it.category_id));
      if (sliceItems.length === 0) continue; // 没匹配上就不出票
      for (const it of sliceItems) coveredByExplicit.add(it.order_item_id);
      dispatches.push({
        printer_id: s.printer_id,
        template_id: s.template_id ?? null,
        printer_role_snapshot: s.printer_role_snapshot,
        label: s.label,
        category_ids: s.category_ids ?? null,
        items: sliceItems.map((it) => ({
          order_item_id: it.order_item_id,
          name: it.name,
          spec: it.spec,
          quantity: it.quantity,
          subtotal: it.subtotal,
          category_id: it.category_id,
        })),
      });
    }

    // 第二遍：处理 catch-all 切片，只收"未被具体切片覆盖"的 items
    const uncoveredItems = items.filter((it) => !coveredByExplicit.has(it.order_item_id));
    let consumedByCatchAll = false;
    for (const s of slices) {
      const isCatchAll = !s.category_ids || s.category_ids.length === 0;
      if (!isCatchAll) continue;
      // catch-all 切片：收所有未被具体切片覆盖的 items
      // 多个 catch-all 都打同一份（多打几台兜底，无害）
      if (uncoveredItems.length === 0) continue;
      consumedByCatchAll = true;
      dispatches.push({
        printer_id: s.printer_id,
        template_id: s.template_id ?? null,
        printer_role_snapshot: s.printer_role_snapshot,
        label: s.label,
        category_ids: null,
        items: uncoveredItems.map((it) => ({
          order_item_id: it.order_item_id,
          name: it.name,
          spec: it.spec,
          quantity: it.quantity,
          subtotal: it.subtotal,
          category_id: it.category_id,
        })),
      });
    }

    return {
      dispatches,
      uncovered: consumedByCatchAll ? [] : uncoveredItems,
    };
  }

  /**
   * Property 28：默认唯一性
   * 给定 dto + 当前所有 plans，计算"if upsert 后"每种 order_type 的默认 plan 数。
   * 不变量：每种 order_type 默认数 ∈ {0, 1}（不能同时 2 个 enabled 默认）。
   */
  static countDefaultsAfter(
    plans: PrintPlanWithSlices[],
    upsertingId: number | null,
    dto: PrintPlanUpsertDto,
  ): { dineInDefaults: number; takeawayDefaults: number } {
    const willBeEnabled = dto.enabled ?? true;
    let dineIn = 0;
    let takeaway = 0;
    let touched = false;
    for (const p of plans) {
      const isUpserting = p.id === upsertingId;
      if (isUpserting) {
        touched = true;
        if (willBeEnabled && dto.is_default_dine_in) dineIn += 1;
        if (willBeEnabled && dto.is_default_takeaway) takeaway += 1;
        continue;
      }
      if (!p.enabled) continue;
      // 因为 upsert 时核会把其它默认位清掉，这里模拟同样行为
      if (dto.is_default_dine_in && willBeEnabled) {
        // 其它 plan 的 dine_in 默认会被清
      } else if (p.is_default_dine_in) {
        dineIn += 1;
      }
      if (dto.is_default_takeaway && willBeEnabled) {
        // 同上
      } else if (p.is_default_takeaway) {
        takeaway += 1;
      }
    }
    if (!touched && upsertingId === null) {
      // 新建场景，dto 提供
      if (willBeEnabled && dto.is_default_dine_in) dineIn += 1;
      if (willBeEnabled && dto.is_default_takeaway) takeaway += 1;
    }
    return { dineInDefaults: dineIn, takeawayDefaults: takeaway };
  }

  // ============================================================
  // 业务方法
  // ============================================================

  async listPlans(): Promise<PrintPlanWithSlices[]> {
    return await this.planRepo.listPlans(true);
  }

  async getPlan(id: number): Promise<PrintPlanWithSlices> {
    const p = await this.planRepo.findPlanById(id);
    if (!p) throw new NotFoundException({ code: 'PLAN_NOT_FOUND', msg: '方案不存在' });
    return p;
  }

  /**
   * 选择订单要用的 plan：
   *  1. 商家显式传 planId → 用那个（必须 enabled）
   *  2. 否则：order.order_type 对应的默认 plan
   *  3. 否则：系统默认（id=1，整单全票）
   */
  async resolvePlanForOrder(orderType: 'dine_in' | 'takeaway', explicitPlanId?: number | null): Promise<PrintPlanWithSlices> {
    if (explicitPlanId) {
      const p = await this.planRepo.findPlanById(explicitPlanId);
      if (!p || !p.enabled) throw new NotFoundException({ code: 'PLAN_NOT_FOUND', msg: '方案不存在或已禁用' });
      return p;
    }
    const defaultPlan = await this.planRepo.findDefaultPlan(orderType);
    if (defaultPlan) return defaultPlan;
    return await this.planRepo.getSystemDefaultPlan();
  }

  async createPlan(dto: PrintPlanUpsertDto): Promise<PrintPlanWithSlices> {
    const v = PrintPlanCore.validatePlanInput(dto);
    if (!v.ok) throw new BadRequestException({ code: v.code, msg: v.reason });
    // 校验 printer 都存在且 enabled
    await this.assertPrintersValid(v.normalized);
    return await this.planRepo.insertPlan(v.normalized);
  }

  async updatePlan(id: number, dto: PrintPlanUpsertDto): Promise<PrintPlanWithSlices> {
    const v = PrintPlanCore.validatePlanInput(dto);
    if (!v.ok) throw new BadRequestException({ code: v.code, msg: v.reason });
    await this.assertPrintersValid(v.normalized);
    const cur = await this.planRepo.findPlanById(id);
    if (!cur) throw new NotFoundException({ code: 'PLAN_NOT_FOUND', msg: '方案不存在' });
    if (cur.is_system_default) {
      // 系统默认 plan 仅允许改 name / description / slices
      const sanitized: PrintPlanUpsertDto = {
        ...v.normalized,
        enabled: true,
        is_default_dine_in: cur.is_default_dine_in,
        is_default_takeaway: cur.is_default_takeaway,
      };
      return await this.planRepo.updatePlan(id, sanitized);
    }
    return await this.planRepo.updatePlan(id, v.normalized);
  }

  async deletePlan(id: number): Promise<void> {
    if (id === SYSTEM_DEFAULT_PLAN_ID) {
      throw new BadRequestException({ code: 'PLAN_PROTECTED', msg: '系统默认方案不可删' });
    }
    const cur = await this.planRepo.findPlanById(id);
    if (!cur) throw new NotFoundException({ code: 'PLAN_NOT_FOUND', msg: '方案不存在' });
    if (cur.is_system_default) {
      throw new BadRequestException({ code: 'PLAN_PROTECTED', msg: '系统默认方案不可删' });
    }
    await this.planRepo.deletePlan(id);
  }

  /**
   * 分类删除联动：清所有 plan 中的悬空分类引用
   * （由 dishesService.deleteCategory 钩子调用，永不抛错）
   */
  async onCategoryDeleted(categoryId: number): Promise<{ slicesAffected: number }> {
    try {
      const affected = await this.planRepo.removeCategoryFromAllSlices(categoryId);
      if (affected > 0) {
        this.logger.log(`[plan] 分类 ${categoryId} 删除后，清理了 ${affected} 个 slice 的引用`);
      }
      return { slicesAffected: affected };
    } catch (err) {
      this.logger.error(`[plan] onCategoryDeleted(${categoryId}) failed: ${(err as Error).message}`);
      return { slicesAffected: 0 };
    }
  }

  /**
   * 启动期巡检：扫描所有 slice 引用，清理悬空分类
   */
  async pruneOrphanCategoryRefs(validCategoryIds: ReadonlyArray<number>): Promise<{ slicesAffected: number; orphanIds: number[] }> {
    try {
      const r = await this.planRepo.pruneOrphanCategoryRefs(validCategoryIds);
      if (r.slicesAffected > 0) {
        this.logger.warn(`[plan-prune] 启动巡检清理 ${r.slicesAffected} 个 slice，悬空分类 ids=${JSON.stringify(r.orphanIds)}`);
      }
      return r;
    } catch (err) {
      this.logger.error(`[plan-prune] failed: ${(err as Error).message}`);
      return { slicesAffected: 0, orphanIds: [] };
    }
  }

  // ============================================================
  // 内部辅助
  // ============================================================

  /** 验证 plan 引用的 printer 都存在 */
  private async assertPrintersValid(dto: PrintPlanUpsertDto): Promise<void> {
    const ids = Array.from(new Set(dto.slices.map((s) => s.printer_id)));
    const printers = await this.printerRepo.listPrinters();
    const printerMap = new Map(printers.map((p) => [p.id, p]));
    for (const id of ids) {
      const p = printerMap.get(id);
      if (!p) {
        throw new BadRequestException({ code: 'PLAN_PRINTER_NOT_FOUND', msg: `打印机 ${id} 不存在` });
      }
    }
    // 顺便把 role_snapshot 自动填充
    for (const s of dto.slices) {
      const p = printerMap.get(s.printer_id);
      if (p && !s.printer_role_snapshot) {
        s.printer_role_snapshot = p.role;
      } else if (p && s.printer_role_snapshot && s.printer_role_snapshot !== p.role) {
        this.logger.warn(`[plan] slice 的 printer_role_snapshot=${s.printer_role_snapshot} 与 printer.role=${p.role} 不一致（保留快照）`);
      }
    }
  }
}
