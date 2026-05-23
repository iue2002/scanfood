/**
 * 打印领域类型
 */

export type PrinterProvider = 'FEIE' | 'BLUETOOTH' | 'BROWSER';
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

/** I15: fields_json 必须包含的最小集 */
export const REQUIRED_TEMPLATE_FIELDS: ReadonlyArray<TemplateField> = ['TABLE_NUMBER', 'ITEMS', 'TOTAL'];

/** R16.2: KITCHEN 角色允许的字段（不含金额、店名等） */
export const KITCHEN_ALLOWED_FIELDS: ReadonlyArray<TemplateField> = ['TABLE_NUMBER', 'ITEMS', 'ORDER_NO', 'REMARK', 'TIME'];

export type PrintWidth = '58mm' | '80mm';

export type PrintJobTrigger = 'NEW_ORDER' | 'ADD_MORE' | 'REPRINT' | 'TEST';
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
  order_id: number | null;
  trigger: PrintJobTrigger;
  payload_json: PrintPayload;
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
  table_number?: string;
  order_no?: string;
  order_time?: string;
  items?: Array<{ name: string; quantity: number; spec?: string | null; subtotal?: number }>;
  total?: number;
  remark?: string | null;
  operator?: string | null;
}

/** 订单投影（M4 已有 OrderExportRow，但打印需要更细粒度） */
export interface OrderProjection {
  order_id: number;
  order_no: string;
  table_number: string;
  store_name: string;
  created_at: Date;
  total_amount: number;
  remark: string | null;
  operator: string | null;
  items: Array<{ name: string; spec: string | null; quantity: number; subtotal: number }>;
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
