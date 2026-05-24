import { mysqlTable, int, varchar, timestamp, decimal, index, boolean, mysqlEnum, json, bigint, uniqueIndex } from "drizzle-orm/mysql-core"

// 系统表（禁止删除）
export const healthCheck = mysqlTable("health_check", {
  id: int("id").autoincrement().primaryKey(),
  updated_at: timestamp("updated_at").defaultNow(),
});

// 用户表（包含顾客和员工/管理员）
// 扩展（merchant-ops-center M1）：仅 ADD COLUMN，禁止改动既有列
//   - token_version：强制下线版本号（删除/禁用/改密时 +1，JwtAuthGuard 校验）
//   - must_change_password：临时密码登录后强制改密
//   - status：账号生命周期（active|disabled|deleted），与 role 解耦
//   - deleted_at：软删除时间戳
export const users = mysqlTable(
  "users",
  {
    id: int("id").autoincrement().primaryKey(),
    username: varchar("username", { length: 50 }).notNull().unique(),
    password: varchar("password", { length: 255 }).notNull(),
    role: varchar("role", { length: 20 }).notNull().default('customer'),
    openid: varchar("openid", { length: 100 }),
    nickname: varchar("nickname", { length: 100 }),
    avatar_url: varchar("avatar_url", { length: 500 }),
    table_number: varchar("table_number", { length: 20 }),
    // ====== merchant-ops-center 扩展 ======
    token_version: int("token_version").notNull().default(0),
    must_change_password: boolean("must_change_password").notNull().default(false),
    status: varchar("status", { length: 20 }).notNull().default('active'), // active|disabled|deleted
    deleted_at: timestamp("deleted_at"),
    // =====================================
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("users_username_idx").on(table.username),
    index("users_role_idx").on(table.role),
    index("users_openid_idx").on(table.openid),
    index("users_status_idx").on(table.status),
    index("users_deleted_at_idx").on(table.deleted_at),
  ]
);

// 桌台表
export const tables = mysqlTable(
  "tables",
  {
    id: int("id").autoincrement().primaryKey(),
    table_number: varchar("table_number", { length: 20 }).notNull().unique(), // 桌台编号：A1, B2等
    capacity: int("capacity").notNull().default(4), // 容纳人数
    status: varchar("status", { length: 20 }).notNull().default('idle'), // idle/occupied/settled
    qr_code_url: varchar("qr_code_url", { length: 500 }), // 二维码图片URL
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("tables_table_number_idx").on(table.table_number),
    index("tables_status_idx").on(table.status),
  ]
);

// 菜品分类表
export const dish_categories = mysqlTable(
  "dish_categories",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 50 }).notNull(),
    sort_order: int("sort_order").notNull().default(0), // 排序
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("dish_categories_sort_order_idx").on(table.sort_order),
  ]
);

// 菜品表
export const dishes = mysqlTable(
  "dishes",
  {
    id: int("id").autoincrement().primaryKey(),
    category_id: int("category_id").notNull().references(() => dish_categories.id),
    name: varchar("name", { length: 100 }).notNull(),
    description: varchar("description", { length: 500 }),
    image_url: varchar("image_url", { length: 500 }),
    price: decimal("price", { precision: 10, scale: 2 }).notNull(), // 基础价格
    status: varchar("status", { length: 20 }).notNull().default('available'), // available/unavailable
    sort_order: int("sort_order").notNull().default(0),
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("dishes_category_id_idx").on(table.category_id),
    index("dishes_status_idx").on(table.status),
    index("dishes_sort_order_idx").on(table.sort_order),
  ]
);

// 菜品规格表（大份、中份、小份）
export const dish_specs = mysqlTable(
  "dish_specs",
  {
    id: int("id").autoincrement().primaryKey(),
    dish_id: int("dish_id").notNull().references(() => dishes.id, { onDelete: "cascade" }),
    spec_name: varchar("spec_name", { length: 20 }).notNull(), // 大份/中份/小份
    price: decimal("price", { precision: 10, scale: 2 }).notNull(), // 该规格价格
    created_at: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("dish_specs_dish_id_idx").on(table.dish_id),
  ]
);

// 订单表
export const orders = mysqlTable(
  "orders",
  {
    id: int("id").autoincrement().primaryKey(),
    table_id: int("table_id").notNull().references(() => tables.id),
    order_number: varchar("order_number", { length: 50 }).notNull().unique(), // 订单号
    total_amount: decimal("total_amount", { precision: 10, scale: 2 }).notNull().default('0'),
    status: varchar("status", { length: 20 }).notNull().default('submitted'), // submitted/printed/settled/cancelled/refunded
    order_type: varchar("order_type", { length: 20 }).notNull().default('dine_in'), // dine_in=堂食, takeaway=外带打包
    user_id: int("user_id").references(() => users.id), // 下单用户（可为空，支持游客点餐）
    remark: varchar("remark", { length: 500 }), // 备注
    printed_at: timestamp("printed_at"), // 打印时间
    settled_at: timestamp("settled_at"), // 结账时间
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("orders_table_id_idx").on(table.table_id),
    index("orders_order_number_idx").on(table.order_number),
    index("orders_status_idx").on(table.status),
    index("orders_user_id_idx").on(table.user_id),
    index("orders_created_at_idx").on(table.created_at),
  ]
);

// 订单明细表
export const order_items = mysqlTable(
  "order_items",
  {
    id: int("id").autoincrement().primaryKey(),
    order_id: int("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    dish_id: int("dish_id").notNull().references(() => dishes.id),
    spec_id: int("spec_id").references(() => dish_specs.id), // 规格ID（可为空）
    dish_name: varchar("dish_name", { length: 100 }).notNull(), // 冗余存储，防止菜品删除后无法查看
    spec_name: varchar("spec_name", { length: 20 }), // 规格名称
    quantity: int("quantity").notNull().default(1),
    price: decimal("price", { precision: 10, scale: 2 }).notNull(), // 单价
    subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull(), // 小计 = price * quantity
    added_by_user_id: int("added_by_user_id").references(() => users.id), // 添加菜品的用户ID
    added_by_nickname: varchar("added_by_nickname", { length: 100 }), // 添加菜品的用户昵称
    phase: varchar("phase", { length: 20 }).notNull().default('order'), // order=首次点餐, add_more=加餐
    add_more_round: int("add_more_round").notNull().default(0), // 加餐轮次：0=首次点餐, 1=第1次加餐, 2=第2次加餐...
    served_at: timestamp("served_at"), // 上菜时间，为空表示未上菜
    created_at: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("order_items_order_id_idx").on(table.order_id),
    index("order_items_dish_id_idx").on(table.dish_id),
    index("order_items_added_by_user_id_idx").on(table.added_by_user_id),
  ]
);

// 购物车表（点餐中，非正式订单）
export const carts = mysqlTable(
  "carts",
  {
    id: int("id").autoincrement().primaryKey(),
    table_id: int("table_id").notNull().references(() => tables.id),
    user_id: int("user_id").references(() => users.id),
    total_amount: decimal("total_amount", { precision: 10, scale: 2 }).notNull().default('0'),
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("carts_table_id_idx").on(table.table_id),
    index("carts_user_id_idx").on(table.user_id),
    index("carts_updated_at_idx").on(table.updated_at),
  ]
);

// 购物车明细表
export const cart_items = mysqlTable(
  "cart_items",
  {
    id: int("id").autoincrement().primaryKey(),
    cart_id: int("cart_id").notNull().references(() => carts.id, { onDelete: "cascade" }),
    dish_id: int("dish_id").notNull().references(() => dishes.id),
    spec_id: int("spec_id").references(() => dish_specs.id),
    dish_name: varchar("dish_name", { length: 100 }).notNull(),
    spec_name: varchar("spec_name", { length: 20 }),
    quantity: int("quantity").notNull().default(1),
    price: decimal("price", { precision: 10, scale: 2 }).notNull(),
    subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull(),
    added_by_user_id: int("added_by_user_id").references(() => users.id),
    added_by_nickname: varchar("added_by_nickname", { length: 100 }),
    created_at: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("cart_items_cart_id_idx").on(table.cart_id),
    index("cart_items_dish_id_idx").on(table.dish_id),
    index("cart_items_added_by_user_id_idx").on(table.added_by_user_id),
  ]
);

// 小票打印记录表
export const print_records = mysqlTable(
  "print_records",
  {
    id: int("id").autoincrement().primaryKey(),
    order_id: int("order_id").notNull().references(() => orders.id),
    status: varchar("status", { length: 20 }).notNull().default('pending'), // pending/success/failed
    error_message: varchar("error_message", { length: 500 }),
    printed_at: timestamp("printed_at"),
    created_at: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("print_records_order_id_idx").on(table.order_id),
    index("print_records_status_idx").on(table.status),
  ]
);

// 退款/售后记录表
export const refunds = mysqlTable(
  "refunds",
  {
    id: int("id").autoincrement().primaryKey(),
    order_id: int("order_id").notNull().references(() => orders.id),
    amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
    reason: varchar("reason", { length: 500 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default('pending'), // pending/approved/rejected
    operator_id: int("operator_id").notNull().references(() => users.id), // 操作人
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("refunds_order_id_idx").on(table.order_id),
    index("refunds_status_idx").on(table.status),
  ]
);

// 店铺配置表（单条记录）
export const store_settings = mysqlTable(
  "store_settings",
  {
    id: int("id").autoincrement().primaryKey(),
    store_name: varchar("store_name", { length: 100 }).notNull().default('伊美轩'),
    store_avatar: varchar("store_avatar", { length: 500 }),
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  }
);

// 桌号验证表（扫码时验证桌号是否有效）
export const table_validations = mysqlTable(
  "table_validations",
  {
    id: int("id").autoincrement().primaryKey(),
    table_number: varchar("table_number", { length: 20 }).notNull().unique(),
    table_id: int("table_id").notNull().references(() => tables.id, { onDelete: "cascade" }),
    created_at: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("table_validations_table_number_idx").on(table.table_number),
    index("table_validations_table_id_idx").on(table.table_id),
  ]
);

// 登录审计日志表（安全加固：记录每次登录尝试）
export const login_logs = mysqlTable(
  "login_logs",
  {
    id: int("id").autoincrement().primaryKey(),
    user_id: int("user_id"),  // 可为空（用户不存在时的失败尝试）
    username: varchar("username", { length: 50 }).notNull(),
    ip_address: varchar("ip_address", { length: 45 }),  // 支持 IPv6
    user_agent: varchar("user_agent", { length: 500 }),
    success: int("success").notNull().default(0),  // 0=失败 1=成功
    failure_reason: varchar("failure_reason", { length: 100 }),  // 失败原因
    created_at: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("login_logs_user_id_idx").on(table.user_id),
    index("login_logs_username_idx").on(table.username),
    index("login_logs_created_at_idx").on(table.created_at),
  ]
);


// ============================================================
// merchant-ops-center 模块表（M1 起增量加入）
// ============================================================

// 审计日志表：所有挂 @Audit 装饰器的写操作在主事务提交后写入
export const audit_logs = mysqlTable(
  "audit_logs",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    actor_user_id: int("actor_user_id"),
    actor_role: varchar("actor_role", { length: 20 }).notNull(),
    action: varchar("action", { length: 64 }).notNull(),
    target_type: varchar("target_type", { length: 32 }).notNull(),
    target_id: varchar("target_id", { length: 64 }),
    payload_json: json("payload_json").notNull(),
    ip_address: varchar("ip_address", { length: 45 }).notNull().default("unknown"),
    user_agent: varchar("user_agent", { length: 500 }).notNull().default("unknown"),
    created_at: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("audit_logs_actor_created_idx").on(t.actor_user_id, t.created_at),
    index("audit_logs_action_created_idx").on(t.action, t.created_at),
    index("audit_logs_target_idx").on(t.target_type, t.target_id),
    index("audit_logs_created_at_idx").on(t.created_at),
  ]
);


// 审计日志归档表（180 天前的记录从主表迁移到这里）
export const audit_logs_archive = mysqlTable(
  "audit_logs_archive",
  {
    id: bigint("id", { mode: "number" }).primaryKey(),
    actor_user_id: int("actor_user_id"),
    actor_role: varchar("actor_role", { length: 20 }).notNull(),
    action: varchar("action", { length: 64 }).notNull(),
    target_type: varchar("target_type", { length: 32 }).notNull(),
    target_id: varchar("target_id", { length: 64 }),
    payload_json: json("payload_json").notNull(),
    ip_address: varchar("ip_address", { length: 45 }).notNull(),
    user_agent: varchar("user_agent", { length: 500 }).notNull(),
    created_at: timestamp("created_at").notNull(),
    archived_at: timestamp("archived_at").defaultNow().notNull(),
  },
  (t) => [
    index("audit_archive_created_idx").on(t.created_at),
    index("audit_archive_action_idx").on(t.action),
  ]
);


// merchant-ops-center M3：用户通知偏好（声音 + 桌面通知事件）
// 与 users 1:1，外键 cascade
export const user_preferences = mysqlTable(
  "user_preferences",
  {
    user_id: int("user_id").primaryKey().references(() => users.id, { onDelete: 'cascade' }),
    sound_enabled: boolean("sound_enabled").notNull().default(true),
    sound_id: varchar("sound_id", { length: 64 }).notNull().default('default'),
    // 元素 ⊆ {NEW_ORDER, ADD_ITEM, REFUND}（I12 由应用层校验）
    desktop_events: json("desktop_events").notNull(),
    updated_at: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  }
);


// merchant-ops-center M4：导出任务表（异步导出 > 5000 行 / 报表生成）
export const export_jobs = mysqlTable(
  "export_jobs",
  {
    id: varchar("id", { length: 36 }).primaryKey(), // uuid
    actor_user_id: int("actor_user_id").notNull().references(() => users.id),
    type: varchar("type", { length: 20 }).notNull(), // 'ORDERS' | 'REPORT_DAILY' | 'REPORT_MONTHLY'
    status: varchar("status", { length: 20 }).notNull().default('pending'), // pending/running/success/failed
    progress: int("progress").notNull().default(0), // 0..100
    row_count: int("row_count"),
    file_path: varchar("file_path", { length: 500 }),
    file_size: bigint("file_size", { mode: "number" }),
    file_name: varchar("file_name", { length: 200 }),
    mime_type: varchar("mime_type", { length: 100 }),
    error_code: varchar("error_code", { length: 64 }),
    error_message: varchar("error_message", { length: 500 }),
    params_json: json("params_json"),
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
    completed_at: timestamp("completed_at"),
  },
  (t) => [
    index("export_jobs_actor_idx").on(t.actor_user_id),
    index("export_jobs_status_idx").on(t.status),
    index("export_jobs_created_idx").on(t.created_at),
  ]
);


// ============================================================
// merchant-ops-center M5：云打印
// ============================================================

// 打印模板表
export const print_templates = mysqlTable(
  "print_templates",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    // TemplateField[] 子集；必须包含 {TABLE_NUMBER, ITEMS, TOTAL}（应用层校验）
    fields_json: json("fields_json").notNull(),
    width: varchar("width", { length: 8 }).notNull().default('80mm'), // '58mm' | '80mm'
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  }
);

// 打印机配置表
export const printer_configs = mysqlTable(
  "printer_configs",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    provider: varchar("provider", { length: 16 }).notNull(), // FEIE | BLUETOOTH | BROWSER
    device_sn: varchar("device_sn", { length: 64 }),
    // AES-256-GCM 密文：iv:tag:ciphertext（hex 拼接）
    device_key_enc: varchar("device_key_enc", { length: 512 }),
    role: varchar("role", { length: 16 }).notNull().default('BOTH'), // CASHIER | KITCHEN | BOTH
    enabled: boolean("enabled").notNull().default(true),
    auto_print: boolean("auto_print").notNull().default(false),
    auto_print_add_more: boolean("auto_print_add_more").notNull().default(false), // 加餐自动打印
    template_id: int("template_id").references(() => print_templates.id, { onDelete: 'set null' }),
    last_online_at: timestamp("last_online_at"),
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [
    index("printer_configs_provider_idx").on(t.provider),
    index("printer_configs_enabled_idx").on(t.enabled),
  ]
);

// 打印任务表
export const print_jobs = mysqlTable(
  "print_jobs",
  {
    id: int("id").autoincrement().primaryKey(),
    printer_id: int("printer_id").notNull().references(() => printer_configs.id, { onDelete: 'cascade' }),
    template_id: int("template_id").references(() => print_templates.id, { onDelete: 'set null' }),
    /** plan_id：触发该 job 的方案 id（追溯用，可选） */
    plan_id: int("plan_id"),
    order_id: int("order_id"),
    /** 'NEW_ORDER' | 'ADD_MORE' | 'REPRINT' | 'TEST' | 'SELECTIVE' */
    trigger: varchar("trigger", { length: 20 }).notNull().default('NEW_ORDER'),
    payload_json: json("payload_json").notNull(),
    /** 选购打印的 item ids（NULL = 整单；非空 = 仅打这些 order_items.id 的菜） */
    selected_item_ids: json("selected_item_ids").$type<number[]>(),
    status: varchar("status", { length: 16 }).notNull().default('PENDING'), // PENDING|SENT|SUCCESS|FAILED
    attempt: int("attempt").notNull().default(0),
    last_error: varchar("last_error", { length: 500 }),
    next_retry_at: timestamp("next_retry_at"),
    provider_job_id: varchar("provider_job_id", { length: 100 }),
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
    completed_at: timestamp("completed_at"),
  },
  (t) => [
    index("print_jobs_printer_status_idx").on(t.printer_id, t.status),
    index("print_jobs_status_retry_idx").on(t.status, t.next_retry_at),
    index("print_jobs_order_idx").on(t.order_id),
    index("print_jobs_created_idx").on(t.created_at),
  ]
);


// merchant-ops M5 增量：高度定制化打印方案
// 一个 plan 可以由多个 slice 组成（每张票 = 一个 slice）
// 同一个分类可以出现在多个 slice（如"酒水"既给烧烤档也给主食档）
export const print_plans = mysqlTable(
  "print_plans",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    enabled: boolean("enabled").notNull().default(true),
    /** 堂食订单的默认方案（业务唯一） */
    is_default_dine_in: boolean("is_default_dine_in").notNull().default(false),
    /** 外带订单的默认方案（业务唯一） */
    is_default_takeaway: boolean("is_default_takeaway").notNull().default(false),
    /** 系统自动建的"整单全票"方案（不可删） */
    is_system_default: boolean("is_system_default").notNull().default(false),
    description: varchar("description", { length: 500 }),
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [
    index("print_plans_default_dine_in_idx").on(t.is_default_dine_in),
    index("print_plans_default_takeaway_idx").on(t.is_default_takeaway),
    index("print_plans_system_idx").on(t.is_system_default),
  ]
);

export const print_plan_slices = mysqlTable(
  "print_plan_slices",
  {
    id: int("id").autoincrement().primaryKey(),
    plan_id: int("plan_id").notNull().references(() => print_plans.id, { onDelete: 'cascade' }),
    printer_id: int("printer_id").notNull().references(() => printer_configs.id, { onDelete: 'cascade' }),
    template_id: int("template_id").references(() => print_templates.id, { onDelete: 'set null' }),
    /** 角色快照（创建时从 printer_configs.role 拷贝；之后 printer 改 role 不影响 slice） */
    printer_role_snapshot: varchar("printer_role_snapshot", { length: 16 }).notNull().default('BOTH'),
    /** 分类过滤：JSON int[]，NULL/[] = catch-all 接收所有分类（兜底切片） */
    category_ids: json("category_ids"),
    label: varchar("label", { length: 100 }).notNull().default(''),
    sort_order: int("sort_order").notNull().default(0),
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [
    index("print_plan_slices_plan_idx").on(t.plan_id),
    index("print_plan_slices_printer_idx").on(t.printer_id),
  ]
);
