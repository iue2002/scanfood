/**
 * 导出领域类型
 */

export type OrderStatusFilter = 'submitted' | 'printed' | 'settled' | 'cancelled' | 'refunded';

export type ExportJobType = 'ORDERS' | 'REPORT_DAILY' | 'REPORT_MONTHLY';
export type ExportJobStatus = 'pending' | 'running' | 'success' | 'failed';

export interface ExportOrdersDto {
  startAt: string; // ISO8601
  endAt: string;   // ISO8601
  status?: OrderStatusFilter[];
}

export type ReportType = 'DAILY' | 'MONTHLY';

export interface ExportReportDto {
  type: ReportType;
  /** YYYY-MM-DD（DAILY）/ YYYY-MM（MONTHLY） */
  date: string;
}

/**
 * 投影到 Excel 行的订单视图
 * 出口列与 R11.3 对齐：订单号 / 桌号 / 下单时间 / 状态 / 菜品明细 / 金额 / 退款 / 操作员
 */
export interface OrderExportRow {
  order_number: string;
  table_number: string;
  order_type: string; // dine_in / takeaway
  created_at: Date;
  status: string;
  item_summary: string; // "宫保鸡丁(辣)x2; 米饭x1"
  total_amount: number;
  refund_amount: number;
  operator: string;
}

export interface ExportJobRow {
  id: string;
  actor_user_id: number;
  type: ExportJobType;
  status: ExportJobStatus;
  progress: number;
  row_count: number | null;
  file_path: string | null;
  file_size: number | null;
  file_name: string | null;
  mime_type: string | null;
  error_code: string | null;
  error_message: string | null;
  params_json: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

/** R12 报表所需聚合数据 */
export interface ReportAggregate {
  storeName: string;
  generatedBy: string;
  generatedAt: Date;
  type: ReportType;
  date: string;        // YYYY-MM-DD or YYYY-MM
  startAt: Date;
  endAt: Date;
  /** 订单总数（status != cancelled） */
  orderCount: number;
  /** 营业额（settled 总和） */
  revenue: number;
  refundAmount: number;
  /** 桌均：revenue / 不重复 table_id 数 */
  perTableAverage: number;
  /** 品类销量（取 dish.category_id 维度）*/
  categorySales: Array<{ category: string; quantity: number; amount: number }>;
  /** Top10 菜品 */
  topDishes: Array<{ name: string; quantity: number; amount: number }>;
  /** 月报独有：按日趋势 */
  dailyTrend?: Array<{ date: string; orderCount: number; revenue: number }>;
}

export const SYNC_THRESHOLD = 5000;
export const RANGE_LIMIT_DAYS = 92;
export const PDF_SIZE_LIMIT = 20 * 1024 * 1024; // 20MB
export const PUPPETEER_TIMEOUT_MS = 60_000;
