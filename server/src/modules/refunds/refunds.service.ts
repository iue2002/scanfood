import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { db } from '@/storage/database/mysql-client';
import { refunds, orders } from '@/storage/database/shared/schema';
import { CreateRefundDto, UpdateRefundStatusDto } from './dto/refund.dto';
import { eq, desc } from 'drizzle-orm';

@Injectable()
export class RefundsService {
  async getRefunds() {
    return await db.select().from(refunds).orderBy(desc(refunds.created_at));
  }

  async getRefundById(id: number) {
    const result = await db.select().from(refunds).where(eq(refunds.id, id));
    const refund = result[0];
    if (!refund) throw new NotFoundException('退款记录不存在');
    return refund;
  }

  async createRefund(dto: CreateRefundDto) {
    const orderResult = await db.select().from(orders).where(eq(orders.id, dto.order_id));
    if (orderResult.length === 0) throw new BadRequestException('订单不存在');

    const insertResult = await db.insert(refunds).values({
      order_id: dto.order_id,
      amount: dto.amount.toFixed(2),
      reason: dto.reason,
      status: 'pending',
      operator_id: 0,
    });
    const newId = (insertResult as any)[0].insertId;
    return await this.getRefundById(newId);
  }

  async updateRefundStatus(id: number, dto: UpdateRefundStatusDto) {
    const refund = await this.getRefundById(id);
    if (refund.status !== 'pending') {
      throw new BadRequestException('该退款申请已处理');
    }

    await db.update(refunds).set({
      status: dto.status,
      operator_id: dto.operator_id || 0,
    }).where(eq(refunds.id, id));

    if (dto.status === 'approved') {
      await db.update(orders).set({ status: 'refunded' }).where(eq(orders.id, refund.order_id));
    }

    return await this.getRefundById(id);
  }
}
