import { mysqlTable, int, varchar, timestamp, decimal, index } from "drizzle-orm/mysql-core"

// 系统表（禁止删除）
export const healthCheck = mysqlTable("health_check", {
  id: int("id").autoincrement().primaryKey(),
  updated_at: timestamp("updated_at").defaultNow(),
});

// 用户表（包含顾客和管理员）
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
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("users_username_idx").on(table.username),
    index("users_role_idx").on(table.role),
    index("users_openid_idx").on(table.openid),
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
    created_at: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("order_items_order_id_idx").on(table.order_id),
    index("order_items_dish_id_idx").on(table.dish_id),
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
