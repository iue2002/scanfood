import { Controller, Get, Post, Body, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { RefundsService } from './refunds.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateRefundDto, UpdateRefundStatusDto } from './dto/refund.dto';

@Controller('refunds')
@UseGuards(JwtAuthGuard)
export class RefundsController {
  constructor(private readonly refundsService: RefundsService) {}

  @Get()
  async getRefunds() {
    return await this.refundsService.getRefunds();
  }

  @Get(':id')
  async getRefundById(@Param('id', ParseIntPipe) id: number) {
    return await this.refundsService.getRefundById(id);
  }

  @Post()
  async createRefund(@Body() dto: CreateRefundDto) {
    return await this.refundsService.createRefund(dto);
  }

  @Post(':id/status')
  async updateRefundStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRefundStatusDto,
  ) {
    return await this.refundsService.updateRefundStatus(id, dto);
  }
}
