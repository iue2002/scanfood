import { Controller, Get, Post, Body, Param, ParseIntPipe } from '@nestjs/common';
import { RefundsService } from './refunds.service';
import { CreateRefundDto, UpdateRefundStatusDto } from './dto/refund.dto';

@Controller('refunds')
export class RefundsController {
  constructor(private readonly refundsService: RefundsService) {}

  @Get()
  async getRefunds() {
    console.log('[GET /api/refunds]');
    return await this.refundsService.getRefunds();
  }

  @Get(':id')
  async getRefundById(@Param('id', ParseIntPipe) id: number) {
    console.log('[GET /api/refunds/:id]', { id });
    return await this.refundsService.getRefundById(id);
  }

  @Post()
  async createRefund(@Body() dto: CreateRefundDto) {
    console.log('[POST /api/refunds]', dto);
    return await this.refundsService.createRefund(dto);
  }

  @Post(':id/status')
  async updateRefundStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRefundStatusDto,
  ) {
    console.log('[POST /api/refunds/:id/status]', { id, dto });
    return await this.refundsService.updateRefundStatus(id, dto);
  }
}
