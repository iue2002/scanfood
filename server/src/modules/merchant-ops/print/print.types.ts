/**
 * 打印领域类型
 */

export type PrinterProvider =
  | 'FEIE'        // 飞鹅云（国内市占率高）
  | 'YLY'         // 易联云（国内主流，跟飞鹅双雄）
  | 'ZYY'         // 中易云 / 365 云打印（商超餐饮常用）
  | 'XPRINTER'    // 芯烨云（硬件厂商自营云服务）
  | 'BLUETOOTH'   // 蓝牙（移动端）
  | 'BROWSER';    // 浏览器（局域网 USB / 网络共享打印机）
export type PrinterRole = 'CASHIER' | 'KITCHEN' | 'BOTH';

export type TemplateField =
  | 'STORE_NAME'
  | 'TABLE_NUMBER'
  | 'ITEMS'
  | 'TOTAL'
  | 'TIME'
  | 'ORDER_NO'
  | 'REMARK'
  | 'OPERATOR';

export const ALL_TEMPLATE_FIELDS: ReadonlyArray<TemplateField> = [
  'STORE_NAME', 'TABLE_NUMBER', 'ITEMS', 'TOTAL', 'TIME', 'ORDER_NO', 'REMARK', 'OPERATOR',
];

/**
 * I15: 任意模板都必须包含的最小集（TABLE_NUMBER + ITEMS）
 *
 * 这两个字段是"打印什么 + 给哪桌"的最低信息，前台/后厨都不能没有。
 * 注意 TOTAL 不在这里：后厨小票按设计就不打金额（顾客隐私 + 后厨无需金额信息），
 * 全票场景的 TOTAL 必选由 REQUIRED_FOR_FULL_RECEIPT 单独检查。
 */
export const REQUIRED_TEMPLATE_FIELDS: ReadonlyArray<TemplateField> = ['TABLE_NUMBER', 'ITEMS'];

/**
 * 全票（CASHIER / BOTH）场景必含字段。后厨模板（仅 KITCHEN 角色用）可不含。
 * 当模板被任何 CASHIER/BOTH 打印机引用时，必须含此集；保存模板时本身放宽，
 * 仅在打印机绑定模板时实施。
 */
export const REQUIRED_FOR_FULL_RECEIPT: ReadonlyArray<TemplateField> = ['TABLE_NUMBER', 'ITEMS', 'TOTAL'];

/** R16.2: KITCHEN 角色允许的字段（不含金额、店名等） */
export const KITCHEN_ALLOWED_FIELDS: ReadonlyArray<TemplateField> = ['TABLE_NUMBER', 'ITEMS', 'ORDER_NO', 'REMARK', 'TIME'];

export type PrintWidth = '58mm' | '80mm';

export type PrintJobTrigger = 'NEW_ORDER' | 'ADD_MORE' | 'REPRINT' | 'TEST' | 'SELECTIVE';
export type PrintJobStatus = 'PENDING' | 'SENT' | 'SUCCESS' | 'FAILED';

export interface PrinterRow {
  id: number;
  name: string;
  provider: PrinterProvider;
  device_sn: string | null;
  /** 解密后的明文 device_key；Repo 投影时已脱敏（external 投影应该用 PrinterPublic） */
  device_key?: string | null;
  role: PrinterRole;
  enabled: boolean;
  auto_print: boolean;
  auto_print_add_more: boolean;
  template_id: number | null;
  last_online_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * 对外投影：绝不包含 device_key 任何派生字段（Property 15 c）
 */
export interface PrinterPublic {
  id: number;
  name: string;
  provider: PrinterProvider;
  device_sn: string | null;
  has_device_key: boolean;
  role: PrinterRole;
  enabled: boolean;
  auto_print: boolean;
  auto_print_add_more: boolean;
  template_id: number | null;
  last_online_at: Date | null;
  online?: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface TemplateRow {
  id: number;
  name: string;
  fields_json: TemplateField[];
  width: PrintWidth;
  created_at: Date;
  updated_at: Date;
}

export interface PrintJobRow {
  id: number;
  printer_id: number;
  template_id: number | null;
  /** 触发该 job 的方案 id（NULL = 系统默认 / TEST / SELECTIVE 等不与 plan 关联） */
  plan_id: number | null;
  order_id: number | null;
  trigger: PrintJobTrigger;
  payload_json: PrintPayload;
  /** 选购打印的 order_items.id 集合（NULL = 整单；非空 = 仅这些菜） */
  selected_item_ids: number[] | null;
  status: PrintJobStatus;
  attempt: number;
  last_error: string | null;
  next_retry_at: Date | null;
  provider_job_id: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

/** 给 PrinterDriverPort.send 的载荷（保留模板渲染所需的所有字段） */
export interface PrintPayload {
  // 模板配置
  width: PrintWidth;
  fields: TemplateField[];
  // 订单数据投影
  store_name?: string;
  /** 真实桌号（外带订单为内部哨兵 '__TAKEAWAY__'，由 order_type 区分） */
  table_number?: string;
  /** 'dine_in' | 'takeaway'；不传时按堂食处理 */
  order_type?: string;
  order_no?: string;
  order_time?: string;
  items?: Array<{ name: string; quantity: number; spec?: string | null; subtotal?: number }>;
  total?: number;
  remark?: string | null;
  operator?: string | null;
}

/** 内部哨兵：外带订单的虚拟"打包"桌台 number（来自 orders 业务层约定） */
export const TAKEAWAY_TABLE_SENTINEL = '__TAKEAWAY__';

/** 订单投影（M4 已有 OrderExportRow，但打印需要更细粒度） */
export interface OrderProjection {
  order_id: number;
  order_no: string;
  /** 真实桌号字符串（外带订单为内部哨兵 '__TAKEAWAY__'，渲染层自行识别） */
  table_number: string;
  /** 'dine_in' | 'takeaway' — 渲染时按外带特殊显示 */
  order_type: string;
  store_name: string;
  created_at: Date;
  total_amount: number;
  remark: string | null;
  /**
   * 操作员（结账/收银的店员）。
   * 注意：当前库里没有"哪个员工处理"的字段，所以总是 null。
   * 不要把订单的 user_id（顾客）当 operator——那是顾客微信昵称，打到小票上是错的。
   */
  operator: string | null;
  items: Array<{
    /** order_items.id（用于选购打印 selected_item_ids 引用） */
    order_item_id: number;
    /** dish_categories.id（用于 plan 切片过滤） */
    category_id: number;
    name: string;
    spec: string | null;
    quantity: number;
    subtotal: number;
  }>;
}

/** 拆单计划：每个 enabled+auto_print 打印机一条 */
export interface PrintPlan {
  printer: PrinterRow;
  template: TemplateRow;
  fields: TemplateField[]; // 角色投影后实际下发的字段子集
}

export interface DriverResponse {
  accepted: boolean;
  providerJobId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

/** 打印机驱动端口（PrintCore 不依赖具体厂商） */
export interface PrinterDriverPort {
  /** 发送一份打印任务；timeoutMs 内必须返回 */
  send(printer: PrinterRow, payload: PrintPayload, timeoutMs: number): Promise<DriverResponse>;
  /** 查询在线状态 */
  queryOnline(printer: PrinterRow): Promise<{ online: boolean; lastSeen?: Date }>;
}

/** 重试调度延迟：30s / 2min / 10min（R17.2） */
export const RETRY_DELAYS_MS: ReadonlyArray<number> = [30_000, 2 * 60_000, 10 * 60_000];

/** R15.2 / R15.3：试打印 5 秒上限 */
export const TEST_PRINT_TIMEOUT_MS = 5_000;
/** 自动打印在重试 tick 中的下发超时 */
export const SEND_TIMEOUT_MS = 5_000;
/** R17.5：单次 retry tick 单台打印机最多下发 50 条 */
export const RETRY_TICK_BATCH_PER_PRINTER = 50;
/** R17.6：print_jobs 保留 7 天 */
export const JOB_RETENTION_DAYS = 7;


// ============================================================
// 高度定制化打印方案（Print Plan）
// ============================================================

/**
 * 打印方案行（print_plans 表）
 *
 * 业务唯一性：
 *   - is_default_dine_in：所有 enabled 方案中至多 1 个
 *   - is_default_takeaway：所有 enabled 方案中至多 1 个
 *   - is_system_default：全局唯一（id=1，不可删）
 */
export interface PrintPlanRow {
  id: number;
  name: string;
  enabled: boolean;
  is_default_dine_in: boolean;
  is_default_takeaway: boolean;
  is_system_default: boolean;
  description: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * 打印方案切片（print_plan_slices 表）
 *
 * 一个 plan 由 N 个切片组成，每个切片 = 一张票。
 * 切片决定：哪台打印机 + 哪个模板 + 打哪些分类的菜品。
 */
export interface PrintPlanSliceRow {
  id: number;
  plan_id: number;
  printer_id: number;
  template_id: number | null;
  printer_role_snapshot: PrinterRole;
  /** NULL/[] = catch-all 接收所有分类（兜底切片，建议每个 plan 至少有一个） */
  category_ids: number[] | null;
  label: string;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}

/**
 * 完整 plan 投影（含 slices）
 */
export interface PrintPlanWithSlices extends PrintPlanRow {
  slices: PrintPlanSliceRow[];
}

/**
 * 创建/更新 plan 用的 DTO
 */
export interface PrintPlanUpsertDto {
  name: string;
  enabled?: boolean;
  is_default_dine_in?: boolean;
  is_default_takeaway?: boolean;
  description?: string | null;
  slices: Array<{
    printer_id: number;
    template_id: number | null;
    /** 创建/更新时从 printer 当前 role 拷贝 */
    printer_role_snapshot?: PrinterRole;
    category_ids: number[] | null;
    label?: string;
    sort_order?: number;
  }>;
}

/**
 * 选购打印参数（手动勾选 items）
 */
export interface SelectivePrintRequest {
  order_id: number;
  printer_id: number;
  template_id?: number | null;
  /** 必填非空：order_items.id 集合 */
  selected_item_ids: number[];
  label?: string;
}

/**
 * 拆分计算结果（PrintPlanCore.splitOrder 输出）
 *
 * 每个元素 = 一张要发出的票
 */
export interface PlanDispatchResult {
  printer_id: number;
  template_id: number | null;
  printer_role_snapshot: PrinterRole;
  label: string;
  /** 分类 id 数组（catch-all 时为 null，渲染时不限） */
  category_ids: number[] | null;
  /** 该切片实际要打的 items（按 plan slice 过滤后） */
  items: Array<{
    order_item_id: number;
    name: string;
    spec: string | null;
    quantity: number;
    subtotal: number;
    category_id: number;
  }>;
}

/** 用于 splitOrder 输入的 OrderItem 投影（含 category_id） */
export interface OrderItemForSplit {
  order_item_id: number;
  category_id: number;
  name: string;
  spec: string | null;
  quantity: number;
  subtotal: number;
}

/** 系统默认 plan id（迁移时插入，不可删） */
export const SYSTEM_DEFAULT_PLAN_ID = 1;
