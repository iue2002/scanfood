import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { db } from '@/storage/database/mysql-client';
import { carts, cart_items, tables } from '@/storage/database/shared/schema';
import { CreateCartDto } from './dto/cart.dto';
import { eq, desc } from 'drizzle-orm';
import { OrdersGateway } from '@/modules/orders/orders.gateway';

@Injectable()
export class CartsService {
  constructor(private readonly ordersGateway: OrdersGateway) {}

  async getTableCurrentCart(tableId: number) {
    const result = await db.select().from(carts)
      .where(eq(carts.table_id, tableId))
      .orderBy(desc(carts.updated_at))
      .limit(1);

    const cart = result[0];
    if (!cart) return null;

    const items = await db.select().from(cart_items).where(eq(cart_items.cart_id, cart.id));
    const tableResult = await db.select().from(tables).where(eq(tables.id, cart.table_id));

    return {
      ...cart,
      cart_items: items,
      tables: tableResult[0] || null,
    };
  }

  async syncCart(dto: CreateCartDto) {
    if (!dto.items) {
      throw new BadRequestException('购物车参数无效');
    }

    if (dto.items.length === 0) {
      const existing = await db.select().from(carts)
        .where(eq(carts.table_id, dto.table_id))
        .orderBy(desc(carts.updated_at))
        .limit(1);

      if (existing[0]) {
        await this.deleteCart(existing[0].id, existing[0].table_id);
      }
      return null;
    }

    const activeCartResult = await db.select().from(carts)
      .where(eq(carts.table_id, dto.table_id))
      .orderBy(desc(carts.updated_at))
      .limit(1);

    const activeCart = activeCartResult[0];

    let totalAmount = 0;
    const itemsToInsert = dto.items.map(item => {
      const subtotal = item.price * item.quantity;
      totalAmount += subtotal;
      return {
        dish_id: item.dish_id,
        spec_id: item.spec_id,
        dish_name: item.dish_name,
        spec_name: item.spec_name,
        quantity: item.quantity,
        price: item.price.toFixed(2),
        subtotal: subtotal.toFixed(2),
        added_by_user_id: item.added_by_user_id || dto.user_id,
        added_by_nickname: item.added_by_nickname || '未知用户',
      };
    });

    let cartId = activeCart?.id;

    if (cartId && activeCart) {
      await db.update(carts).set({
        total_amount: totalAmount.toFixed(2),
        user_id: dto.user_id || activeCart.user_id,
        updated_at: new Date(),
      }).where(eq(carts.id, cartId));

      await db.delete(cart_items).where(eq(cart_items.cart_id, cartId));
      await db.insert(cart_items).values(itemsToInsert.map(item => ({ ...item, cart_id: cartId as number })));
    } else {
      const insertResult = await db.insert(carts).values({
        table_id: dto.table_id,
        user_id: dto.user_id,
        total_amount: totalAmount.toFixed(2),
      });
      cartId = (insertResult as any)[0].insertId;
      await db.insert(cart_items).values(itemsToInsert.map(item => ({ ...item, cart_id: cartId as number })));
    }

    const cart = await this.getCartById(cartId as number);
    this.ordersGateway.notifyTableCartUpdate(dto.table_id, cart);
    return cart;
  }

  async getCartById(cartId: number) {
    const result = await db.select().from(carts).where(eq(carts.id, cartId));
    const cart = result[0];
    if (!cart) throw new NotFoundException('购物车不存在');

    const items = await db.select().from(cart_items).where(eq(cart_items.cart_id, cartId));
    const tableResult = await db.select().from(tables).where(eq(tables.id, cart.table_id));

    return {
      ...cart,
      cart_items: items,
      tables: tableResult[0] || null,
    };
  }

  async deleteCart(cartId: number, tableId?: number) {
    const cart = await db.select().from(carts).where(eq(carts.id, cartId));
    const current = cart[0];

    // 幂等：购物车已不存在（多人同时清空或已被提交订单时清理），直接返回成功
    if (!current) {
      if (tableId) {
        this.ordersGateway.notifyTableCartUpdate(tableId, null);
      }
      return { success: true, message: '购物车已不存在' };
    }

    await db.delete(cart_items).where(eq(cart_items.cart_id, cartId));
    await db.delete(carts).where(eq(carts.id, cartId));

    const notifyTableId = tableId ?? current.table_id;
    this.ordersGateway.notifyTableCartUpdate(notifyTableId, null);
    return { success: true };
  }
}
