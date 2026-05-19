import { relations } from "drizzle-orm/relations";
import { carts, cart_items, orders, order_items, tables, users } from "./schema";

export const cartsRelations = relations(carts, ({ one, many }) => ({
	table: one(tables, {
		fields: [carts.table_id],
		references: [tables.id],
	}),
	user: one(users, {
		fields: [carts.user_id],
		references: [users.id],
	}),
	items: many(cart_items),
}));

export const cartItemsRelations = relations(cart_items, ({ one }) => ({
	cart: one(carts, {
		fields: [cart_items.cart_id],
		references: [carts.id],
	}),
	user: one(users, {
		fields: [cart_items.added_by_user_id],
		references: [users.id],
	}),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
	table: one(tables, {
		fields: [orders.table_id],
		references: [tables.id],
	}),
	user: one(users, {
		fields: [orders.user_id],
		references: [users.id],
	}),
	items: many(order_items),
}));

