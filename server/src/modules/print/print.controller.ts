import { Controller, Get, Post, Body, Param, ParseIntPipe, Query } from '@nestjs/common';
import { PrintService } from './print.service';
import { PrintReportDto } from './dto/print.dto';

@Controller('print')
export class PrintController {
  constructor(private readonly printService: PrintService) {}

  @Get('records')
  async getPrintRecords(@Query('order_id') orderId?: string) {
    console.log('[GET /api/print/records]', { orderId });
    const id = orderId ? parseInt(orderId, 10) : undefined;
    return await this.printService.getPrintRecords(id);
  }

  @Post(':orderId/reprint')
  async reprintOrder(@Param('orderId', ParseIntPipe) orderId: number) {
    console.log('[POST /api/print/:orderId/reprint]', { orderId });
    return await this.printService.reprintOrder(orderId);
  }

  @Post('report')
  async printReport(@Body() dto: PrintReportDto) {
    console.log('[POST /api/print/report]', dto);
    return await this.printService.printReport(dto);
  }
}
