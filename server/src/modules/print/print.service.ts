import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { db } from '@/storage/database/mysql-client';
import { print_records, orders, order_items, tables } from '@/storage/database/shared/schema';
import { eq, desc } from 'drizzle-orm';

@Injectable()
export class PrintService {
  async getPrintRecords(orderId?: number) {
    if (orderId) {
      return await db.select().from(print_records).where(eq(print_records.order_id, orderId)).orderBy(desc(print_records.created_at));
    }
    return await db.select().from(print_records).orderBy(desc(print_records.created_at));
  }

  async reprintOrder(orderId: number) {
    const orderResult = await db.select().from(orders).where(eq(orders.id, orderId));
    if (orderResult.length === 0) throw new NotFoundException('订单不存在');

    const insertResult = await db.insert(print_records).values({
      order_id: orderId,
      status: 'pending',
    });
    const printId = (insertResult as any)[0].insertId;

    try {
      const items = await db.select().from(order_items).where(eq(order_items.order_id, orderId));
      const tableResult = await db.select().from(tables).where(eq(tables.id, orderResult[0].table_id));

      console.log('重新打印小票:', {
        order_number: orderResult[0].order_number,
        table_number: tableResult[0]?.table_number,
        items,
        total: orderResult[0].total_amount,
      });

      await db.update(print_records).set({
        status: 'success',
        printed_at: new Date(),
      }).where(eq(print_records.id, printId));

      return { message: '打印成功' };
    } catch (err) {
      await db.update(print_records).set({
        status: 'failed',
        error_message: String(err),
      }).where(eq(print_records.id, printId));
      throw new BadRequestException('打印失败');
    }
  }

  async printReport(data: { title: string; content: string }) {
    const insertResult = await db.insert(print_records).values({
      order_id: 0,
      status: 'pending',
    });
    const printId = (insertResult as any)[0].insertId;

    try {
      console.log('打印财报小票:', {
        title: data.title,
        content: data.content,
      });

      await db.update(print_records).set({
        status: 'success',
        printed_at: new Date(),
      }).where(eq(print_records.id, printId));

      return { message: '财报打印成功' };
    } catch (err) {
      await db.update(print_records).set({
        status: 'failed',
        error_message: String(err),
      }).where(eq(print_records.id, printId));
      throw new BadRequestException('财报打印失败');
    }
  }
}
