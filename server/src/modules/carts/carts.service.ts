import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { db } from '@/storage/database/mysql-client';
import { carts, cart_items, tables, dishes } from '@/storage/database/shared/schema';
import { CreateCartDto, SyncCartOpsDto } from './dto/cart.dto';
import { eq, desc, and, sql } from 'drizzle-orm';
import { OrdersGateway } from '@/modules/orders/orders.gateway';

// 内存级幂等去重：最近 5 分钟内处理过的 idempotencyKey
// 单进程部署足够；多进程部署需切 Redis，但当前项目规模下内存即可
const recentOps = new Map<string, number>();
const RECENT_OPS_TTL_MS = 5 * 60 * 1000;

function isDuplicateOp(key: string): boolean {
  const now = Date.now();
  const lastSeen = recentOps.get(key);
  if (lastSeen && now - lastSeen < RECENT_OPS_TTL_MS) {
    return true;
  }
  return false;
}

function markOpProcessed(key: string) {
  recentOps.set(key, Date.now());
  // 简单清理：每 100 次写操作扫描一次过期项
  if (recentOps.size % 100 === 0) {
    const now = Date.now();
    for (const [k, v] of recentOps) {
      if (now - v > RECENT_OPS_TTL_MS) {
        recentOps.delete(k);
      }
    }
  }
}

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

  // ====== 增量操作流：多人同时加菜时不互相覆盖 ======
  async syncCartOps(dto: SyncCartOpsDto) {
    if (!dto.ops || dto.ops.length === 0) {
      return null;
    }

    // 1. 幂等去重：过滤掉最近 5 分钟内已处理过的操作
    const ops = dto.ops.filter(op => !isDuplicateOp(op.idempotencyKey));
    if (ops.length === 0) {
      return null;
    }

    // 2. 去重后如果只剩无效操作，直接返回
    const effectiveOps = ops.filter(o => !((o.action === 'add' || o.action === 'remove') && o.quantity <= 0));
    if (effectiveOps.length === 0) {
      ops.forEach(op => markOpProcessed(op.idempotencyKey));
      return null;
    }

    const MAX_RETRIES = 3;
    let lastError: any;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const txResult = await db.transaction(async (tx) => {
          // 2.1 找到当前桌台的活跃购物车
          const activeCartResult = await tx.select().from(carts)
            .where(eq(carts.table_id, dto.table_id))
            .orderBy(desc(carts.updated_at))
            .limit(1);

          let cartId = activeCartResult[0]?.id;
          let currentVersion = activeCartResult[0]?.version ?? 0;

          // 2.2 没有购物车且操作非空（且不只是 remove），先创建一个
          const hasNonRemove = effectiveOps.some(o => o.action !== 'remove');
          if (!cartId && hasNonRemove) {
            const insertResult = await tx.insert(carts).values({
              table_id: dto.table_id,
              user_id: dto.user_id,
              total_amount: '0.00',
              version: 0,
            });
            cartId = (insertResult as any)[0].insertId;
            currentVersion = 0;
          }

          if (!cartId) {
            return { deleted: true, tableId: dto.table_id, cartId: null };
          }

          // 2.3 逐个执行增量操作
          for (const op of effectiveOps) {
            if (op.action === 'add') {
              const dishResult = await tx.select().from(dishes).where(eq(dishes.id, op.dish_id)).limit(1);
              const dish = dishResult[0];
              if (!dish) continue;

              const price = parseFloat(dish.price);
              const subtotal = op.quantity * price;

              // MySQL INSERT ... ON DUPLICATE KEY UPDATE：原子级累加，天然免疫并发竞态
              await tx.insert(cart_items).values({
                cart_id: cartId,
                dish_id: op.dish_id,
                dish_name: dish.name,
                quantity: op.quantity,
                price: price.toFixed(2),
                subtotal: subtotal.toFixed(2),
                added_by_user_id: op.added_by_user_id || dto.user_id,
                added_by_nickname: op.added_by_nickname || '未知用户',
              }).onDuplicateKeyUpdate({
                set: {
                  quantity: sql`quantity + ${op.quantity}`,
                  subtotal: sql`price * (quantity + ${op.quantity})`,
                }
              });
            } else if (op.action === 'remove') {
              const existing = await tx.select().from(cart_items)
                .where(and(eq(cart_items.cart_id, cartId), eq(cart_items.dish_id, op.dish_id)));
              const existingItem = existing[0];
              if (!existingItem) continue;

              const newQty = existingItem.quantity - op.quantity;
              if (newQty <= 0) {
                await tx.delete(cart_items).where(eq(cart_items.id, existingItem.id));
              } else {
                const subtotal = newQty * parseFloat(existingItem.price);
                await tx.update(cart_items)
                  .set({ quantity: newQty, subtotal: subtotal.toFixed(2) })
                  .where(eq(cart_items.id, existingItem.id));
              }
            } else if (op.action === 'set') {
              if (op.quantity <= 0) {
                await tx.delete(cart_items)
                  .where(and(eq(cart_items.cart_id, cartId), eq(cart_items.dish_id, op.dish_id)));
              } else {
                const existing = await tx.select().from(cart_items)
                  .where(and(eq(cart_items.cart_id, cartId), eq(cart_items.dish_id, op.dish_id)));
                const existingItem = existing[0];

                if (existingItem) {
                  const subtotal = op.quantity * parseFloat(existingItem.price);
                  await tx.update(cart_items)
                    .set({ quantity: op.quantity, subtotal: subtotal.toFixed(2) })
                    .where(eq(cart_items.id, existingItem.id));
                } else {
                  const dishResult = await tx.select().from(dishes).where(eq(dishes.id, op.dish_id)).limit(1);
                  const dish = dishResult[0];
                  if (dish) {
                    const subtotal = op.quantity * parseFloat(dish.price);
                    await tx.insert(cart_items).values({
                      cart_id: cartId,
                      dish_id: op.dish_id,
                      dish_name: dish.name,
                      quantity: op.quantity,
                      price: parseFloat(dish.price).toFixed(2),
                      subtotal: subtotal.toFixed(2),
                      added_by_user_id: op.added_by_user_id || dto.user_id,
                      added_by_nickname: op.added_by_nickname || '未知用户',
                    });
                  }
                }
              }
            }
          }

          // 2.4 重新计算 total_amount
          const allItems = await tx.select().from(cart_items).where(eq(cart_items.cart_id, cartId));
          const totalAmount = allItems.reduce((sum, item) => sum + parseFloat(item.subtotal), 0);

          // 2.5 乐观锁更新 carts：WHERE version = currentVersion
          await tx.update(carts)
            .set({
              total_amount: totalAmount.toFixed(2),
              updated_at: new Date(),
              version: sql`version + 1`
            })
            .where(and(eq(carts.id, cartId), eq(carts.version, currentVersion)));

          // 2.6 验证乐观锁：更新后 version 必须变化
          const verify = await tx.select({ version: carts.version }).from(carts).where(eq(carts.id, cartId));
          if (!verify[0] || verify[0].version !== currentVersion + 1) {
            throw new Error('OPTIMISTIC_LOCK_CONFLICT');
          }

          // 2.7 如果购物车空了，删除它
          if (allItems.length === 0) {
            await tx.delete(carts).where(eq(carts.id, cartId));
            return { deleted: true, tableId: dto.table_id, cartId: null };
          }

          return { deleted: false, tableId: dto.table_id, cartId };
        });

        // 事务成功提交后才标记幂等键，防止回滚后丢失操作
        ops.forEach(op => markOpProcessed(op.idempotencyKey));

        if (txResult.deleted) {
          this.ordersGateway.notifyTableCartUpdate(dto.table_id, null);
          return null;
        }

        const cart = await this.getCartById(txResult.cartId!);
        this.ordersGateway.notifyTableCartUpdate(dto.table_id, cart);
        return cart;
      } catch (err: any) {
        lastError = err;
        if (err?.message === 'OPTIMISTIC_LOCK_CONFLICT' && attempt < MAX_RETRIES - 1) {
          // 指数退避 + 抖动，避免多客户端同步重试
          await new Promise(r => setTimeout(r, 50 * (attempt + 1) + Math.floor(Math.random() * 30)));
          continue;
        }
        throw err;
      }
    }

    throw lastError;
  }
}
