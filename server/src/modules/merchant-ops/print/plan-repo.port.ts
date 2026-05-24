import type {
  PrintPlanRow,
  PrintPlanSliceRow,
  PrintPlanWithSlices,
  PrintPlanUpsertDto,
} from './print.types';

/**
 * 打印方案持久化端口
 *
 * 业务唯一性约束：
 *   - 每个 order_type 同时最多 1 个 enabled 默认 plan
 *     由 Core 在 upsert 时通过事务先清掉旧默认再设新默认实现
 *   - 系统默认 plan（id=1, is_system_default=true）：不能删，name 可改
 */
export interface PrintPlanRepoPort {
  // ============ Plan ============
  listPlans(includeDisabled?: boolean): Promise<PrintPlanWithSlices[]>;
  findPlanById(id: number): Promise<PrintPlanWithSlices | null>;
  findDefaultPlan(orderType: 'dine_in' | 'takeaway'): Promise<PrintPlanWithSlices | null>;
  /** 始终返回系统默认 plan（id=1）；不存在时抛错（不应发生） */
  getSystemDefaultPlan(): Promise<PrintPlanWithSlices>;

  /**
   * 创建 plan + slices（一次事务）
   * 若 dto.is_default_* 为 true，先把同 order_type 的其它 plan 默认位清掉
   */
  insertPlan(dto: PrintPlanUpsertDto): Promise<PrintPlanWithSlices>;

  /**
   * 更新 plan + slices（删旧 slices 重建；同事务清理其它默认位）
   * 系统默认 plan 仅允许改 name / description / slices，禁止改 enabled / is_system_default
   */
  updatePlan(id: number, dto: PrintPlanUpsertDto): Promise<PrintPlanWithSlices>;

  deletePlan(id: number): Promise<void>;

  // ============ 跨方案治理 ============
  /**
   * 分类被删除时清理：把所有 plan_slice.category_ids 中的 categoryId 移除
   * 切片若变成空数组则保留为 catch-all（NULL），不删切片本身
   * 返回受影响的 slice 数
   */
  removeCategoryFromAllSlices(categoryId: number): Promise<number>;

  /**
   * 启动期巡检：扫所有 slice 的 category_ids，移除指向已删分类的 id
   * 返回被清理的 slice 数 + 被清理的 id 列表
   */
  pruneOrphanCategoryRefs(validCategoryIds: ReadonlyArray<number>): Promise<{ slicesAffected: number; orphanIds: number[] }>;
}
