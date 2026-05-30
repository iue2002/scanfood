/**
 * OrderLifecycleCore: 订单状态机纯函数
 *
 * 职责：集中管理所有订单状态的合法流转规则，替代散落在各 Service 中的
 * `['submitted', 'printed', 'unpaid'].includes(order.status)` 硬编码。
 *
 * 状态定义（与 schema 注释一致）：
 *   - draft     草稿
 *   - submitted 已提交（待打印）
 *   - printed   已打印（待上菜/加餐）
 *   - unpaid    待结账（已上菜完毕）
 *   - settled   已结账
 *   - cancelled 已取消
 *   - refunded  已退款
 */

export const ORDER_STATUS = {
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  PRINTED: 'printed',
  UNPAID: 'unpaid',
  SETTLED: 'settled',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
} as const;

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

/** 活跃状态：顾客详情页需要锁定 */
const ACTIVE_STATUSES: ReadonlySet<string> = new Set([
  ORDER_STATUS.SUBMITTED,
  ORDER_STATUS.PRINTED,
  ORDER_STATUS.UNPAID,
]);

/** 允许追加菜品的状态 */
const ADD_MORE_ALLOWED: ReadonlySet<string> = new Set([
  ORDER_STATUS.SUBMITTED,
  ORDER_STATUS.PRINTED,
  ORDER_STATUS.UNPAID,
]);

/** 允许修改明细的状态（删菜/改数量） */
const MUTABLE_STATUSES: ReadonlySet<string> = new Set([
  ORDER_STATUS.SUBMITTED,
  ORDER_STATUS.PRINTED,
]);

/** 允许结算的状态 */
const SETTLEABLE_STATUSES: ReadonlySet<string> = new Set([
  ORDER_STATUS.SUBMITTED,
  ORDER_STATUS.PRINTED,
  ORDER_STATUS.UNPAID,
]);

/** 允许标记上菜的状态 */
const SERVABLE_STATUSES: ReadonlySet<string> = ADD_MORE_ALLOWED;

/** 结算后需要释放桌台 */
const RELEASE_TABLE_STATUSES: ReadonlySet<string> = new Set([
  ORDER_STATUS.SETTLED,
  ORDER_STATUS.CANCELLED,
  ORDER_STATUS.REFUNDED,
]);

/** 占用桌台状态的订单（用于判断是否需要释放桌台） */
const OCCUPYING_TABLE_STATUSES: ReadonlySet<string> = new Set([
  ORDER_STATUS.DRAFT,
  ORDER_STATUS.SUBMITTED,
  ORDER_STATUS.PRINTED,
  ORDER_STATUS.UNPAID,
]);

export class OrderLifecycleCore {
  /** 是否为活跃订单（顾客详情页需锁定 / 桌台看板会显示） */
  static isActiveStatus(status: string): boolean {
    return ACTIVE_STATUSES.has(status);
  }

  /** 是否允许加菜（顾客 + 商家） */
  static canAddMore(status: string): boolean {
    return ADD_MORE_ALLOWED.has(status);
  }

  /** 是否允许结算 */
  static canSettle(status: string): boolean {
    return SETTLEABLE_STATUSES.has(status);
  }

  /** 是否允许标记/取消上菜 */
  static canMarkServed(status: string): boolean {
    return SERVABLE_STATUSES.has(status);
  }

  /** 是否允许修改明细（删菜/改数量） */
  static canModifyItems(status: string): boolean {
    return MUTABLE_STATUSES.has(status);
  }

  /** 结算/取消/退款后是否需要释放桌台 */
  static shouldReleaseTable(status: string): boolean {
    return RELEASE_TABLE_STATUSES.has(status);
  }

  /** 是否占用桌台（用于 deleteOrder 判断是否有其他活跃订单） */
  static isOccupyingTable(status: string): boolean {
    return OCCUPYING_TABLE_STATUSES.has(status);
  }

  /** 打印标记后的下一个状态：submitted → printed */
  static nextStatusOnPrint(current: string): OrderStatus {
    if (current === ORDER_STATUS.SUBMITTED) {
      return ORDER_STATUS.PRINTED;
    }
    return current as OrderStatus;
  }

  /** 只有 draft 状态可以删除 */
  static canDelete(status: string): boolean {
    return status === ORDER_STATUS.DRAFT;
  }

  /** 获取活跃状态列表（供数据库查询使用） */
  static activeStatuses(): readonly string[] {
    return [...ACTIVE_STATUSES];
  }
}
