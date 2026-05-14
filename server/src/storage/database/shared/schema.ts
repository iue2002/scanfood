import { pgTable, serial, varchar, timestamp, boolean, integer, numeric, index } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

// 系统表（禁止删除）
export const healthCheck = pgTable("health_check", {
  id: serial().notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

// 用户表（包含顾客和管理员）
export const users = pgTable(
  "users",
  {
    id: serial().primaryKey(),
    username: varchar("username", { length: 50 }).notNull().unique(),
    password: varchar("password", { length: 255 }).notNull(),
    role: varchar("role", { length: 20 }).notNull().default('customer'), // customer/admin/staff
    openid: varchar("openid", { length: 100 }), // 微信openid
    nickname: varchar("nickname", { length: 100 }),
    avatar_url: varchar("avatar_url", { length: 500 }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("users_username_idx").on(table.username),
    index("users_role_idx").on(table.role),
    index("users_openid_idx").on(table.openid),
  ]
);

// 桌台表
export const tables = pgTable(
  "tables",
  {
    id: serial().primaryKey(),
    table_number: varchar("table_number", { length: 20 }).notNull().unique(), // 桌台编号：A1, B2等
    capacity: integer("capacity").notNull().default(4), // 容纳人数
    status: varchar("status", { length: 20 }).notNull().default('idle'), // idle/occupied/settled
    qr_code_url: varchar("qr_code_url", { length: 500 }), // 二维码图片URL
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("tables_table_number_idx").on(table.table_number),
    index("tables_status_idx").on(table.status),
  ]
);

// 菜品分类表
export const dish_categories = pgTable(
  "dish_categories",
  {
    id: serial().primaryKey(),
    name: varchar("name", { length: 50 }).notNull(),
    sort_order: integer("sort_order").notNull().default(0), // 排序
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("dish_categories_sort_order_idx").on(table.sort_order),
  ]
);

// 菜品表
export const dishes = pgTable(
  "dishes",
  {
    id: serial().primaryKey(),
    category_id: integer("category_id").notNull().references(() => dish_categories.id),
    name: varchar("name", { length: 100 }).notNull(),
    description: varchar("description", { length: 500 }),
    image_url: varchar("image_url", { length: 500 }),
    price: numeric("price", { precision: 10, scale: 2 }).notNull(), // 基础价格
    status: varchar("status", { length: 20 }).notNull().default('available'), // available/unavailable
    sort_order: integer("sort_order").notNull().default(0),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("dishes_category_id_idx").on(table.category_id),
    index("dishes_status_idx").on(table.status),
    index("dishes_sort_order_idx").on(table.sort_order),
  ]
);

// 菜品规格表（大份、中份、小份）
export const dish_specs = pgTable(
  "dish_specs",
  {
    id: serial().primaryKey(),
    dish_id: integer("dish_id").notNull().references(() => dishes.id, { onDelete: "cascade" }),
    spec_name: varchar("spec_name", { length: 20 }).notNull(), // 大份/中份/小份
    price: numeric("price", { precision: 10, scale: 2 }).notNull(), // 该规格价格
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("dish_specs_dish_id_idx").on(table.dish_id),
  ]
);

// 订单表
export const orders = pgTable(
  "orders",
  {
    id: serial().primaryKey(),
    table_id: integer("table_id").notNull().references(() => tables.id),
    order_number: varchar("order_number", { length: 50 }).notNull().unique(), // 订单号
    total_amount: numeric("total_amount", { precision: 10, scale: 2 }).notNull().default('0'),
    status: varchar("status", { length: 20 }).notNull().default('submitted'), // submitted/printed/settled/cancelled/refunded
    user_id: integer("user_id").references(() => users.id), // 下单用户（可为空，支持游客点餐）
    remark: varchar("remark", { length: 500 }), // 备注
    printed_at: timestamp("printed_at", { withTimezone: true }), // 打印时间
    settled_at: timestamp("settled_at", { withTimezone: true }), // 结账时间
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
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
export const order_items = pgTable(
  "order_items",
  {
    id: serial().primaryKey(),
    order_id: integer("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    dish_id: integer("dish_id").notNull().references(() => dishes.id),
    spec_id: integer("spec_id").references(() => dish_specs.id), // 规格ID（可为空）
    dish_name: varchar("dish_name", { length: 100 }).notNull(), // 冗余存储，防止菜品删除后无法查看
    spec_name: varchar("spec_name", { length: 20 }), // 规格名称
    quantity: integer("quantity").notNull().default(1),
    price: numeric("price", { precision: 10, scale: 2 }).notNull(), // 单价
    subtotal: numeric("subtotal", { precision: 10, scale: 2 }).notNull(), // 小计 = price * quantity
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("order_items_order_id_idx").on(table.order_id),
    index("order_items_dish_id_idx").on(table.dish_id),
  ]
);

// 小票打印记录表
export const print_records = pgTable(
  "print_records",
  {
    id: serial().primaryKey(),
    order_id: integer("order_id").notNull().references(() => orders.id),
    status: varchar("status", { length: 20 }).notNull().default('pending'), // pending/success/failed
    error_message: varchar("error_message", { length: 500 }),
    printed_at: timestamp("printed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("print_records_order_id_idx").on(table.order_id),
    index("print_records_status_idx").on(table.status),
  ]
);

// 退款/售后记录表
export const refunds = pgTable(
  "refunds",
  {
    id: serial().primaryKey(),
    order_id: integer("order_id").notNull().references(() => orders.id),
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
    reason: varchar("reason", { length: 500 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default('pending'), // pending/approved/rejected
    operator_id: integer("operator_id").notNull().references(() => users.id), // 操作人
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("refunds_order_id_idx").on(table.order_id),
    index("refunds_status_idx").on(table.status),
  ]
);
