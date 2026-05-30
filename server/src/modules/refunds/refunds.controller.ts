import { Controller, Get, Post, Body, Param, Query, ParseIntPipe, UseGuards } from '@nestjs/common';
import { RefundsService } from './refunds.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../merchant-ops/auth/permissions.guard';
import { Audit, Permissions } from '../merchant-ops/auth/decorators';
import { CreateRefundDto, UpdateRefundStatusDto } from './dto/refund.dto';

@Controller('refunds')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RefundsController {
  constructor(private readonly refundsService: RefundsService) {}

  @Permissions('REFUND_READ')
  @Get()
  async getRefunds(
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
  ) {
    const p = page ? parseInt(page, 10) : 1;
    const ps = pageSize ? parseInt(pageSize, 10) : 20;
    return await this.refundsService.getRefunds(p, ps);
  }

  @Permissions('REFUND_READ')
  @Get(':id')
  async getRefundById(@Param('id', ParseIntPipe) id: number) {
    return await this.refundsService.getRefundById(id);
  }

  @Permissions('ORDER_REFUND')
  @Audit('ORDER_REFUND')
  @Post()
  async createRefund(@Body() dto: CreateRefundDto) {
    return await this.refundsService.createRefund(dto);
  }

  @Permissions('ORDER_REFUND')
  @Audit('ORDER_REFUND')
  @Post(':id/status')
  async updateRefundStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRefundStatusDto,
  ) {
    return await this.refundsService.updateRefundStatus(id, dto);
  }
}
