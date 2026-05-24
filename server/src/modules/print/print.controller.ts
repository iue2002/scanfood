import { Controller, Get, Post, Body, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { PrintService } from './print.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrintReportDto } from './dto/print.dto';

@Controller('print')
@UseGuards(JwtAuthGuard)
export class PrintController {
  constructor(private readonly printService: PrintService) {}

  @Get('records')
  async getPrintRecords(@Query('order_id') orderId?: string) {
    const id = orderId ? parseInt(orderId, 10) : undefined;
    return await this.printService.getPrintRecords(id);
  }

  @Post(':orderId/reprint')
  async reprintOrder(@Param('orderId', ParseIntPipe) orderId: number) {
    return await this.printService.reprintOrder(orderId);
  }

  @Post('report')
  async printReport(@Body() dto: PrintReportDto) {
    return await this.printService.printReport(dto);
  }
}
