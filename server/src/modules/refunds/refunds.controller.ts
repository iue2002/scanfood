import { Controller, Get, Post, Body, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { RefundsService } from './refunds.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../merchant-ops/auth/permissions.guard';
import { Permissions } from '../merchant-ops/auth/decorators';
import { CreateRefundDto, UpdateRefundStatusDto } from './dto/refund.dto';

@Controller('refunds')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RefundsController {
  constructor(private readonly refundsService: RefundsService) {}

  @Permissions('REFUND_READ')
  @Get()
  async getRefunds() {
    return await this.refundsService.getRefunds();
  }

  @Permissions('REFUND_READ')
  @Get(':id')
  async getRefundById(@Param('id', ParseIntPipe) id: number) {
    return await this.refundsService.getRefundById(id);
  }

  @Permissions('ORDER_REFUND')
  @Post()
  async createRefund(@Body() dto: CreateRefundDto) {
    return await this.refundsService.createRefund(dto);
  }

  @Permissions('ORDER_REFUND')
  @Post(':id/status')
  async updateRefundStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRefundStatusDto,
  ) {
    return await this.refundsService.updateRefundStatus(id, dto);
  }
}
