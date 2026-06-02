import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import * as fs from 'fs';
import { JwtAuthGuard } from '@/modules/auth/jwt-auth.guard';
import { extractClientIp } from '@/common/client-ip';
import { PermissionsGuard } from '../auth/permissions.guard';
import { Audit, Permissions } from '../auth/decorators';
import { ExportCore } from './export.core';
import { ExportOrdersBodyDto, ExportReportBodyDto } from './export.dto';
import { ExportRateLimitGuard } from '../common/rate-limit.guard';
import type { ActorContext } from '../auth/rbac.types';

/**
 * 导出 controller
 *
 * 路径前缀：/api/merchant-ops/exports
 *
 * - POST /orders   → @Permissions('EXPORT_ORDERS') @Audit('EXPORT_ORDERS')
 * - GET  /:jobId   → 仅 jwt
 * - GET  /:jobId/download
 * - POST /reports  → @Permissions('EXPORT_REPORT') @Audit('EXPORT_REPORT')
 *
 * Validates: Requirements 11.x, 12.x
 */
@Controller('merchant-ops/exports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ExportController {
  constructor(private readonly core: ExportCore) {}

  private buildActor(req: any): ActorContext {
    return {
      userId: req?.user?.userId,
      role: req?.user?.role,
      ip: extractClientIp(req),
      userAgent: req?.headers?.['user-agent'] ?? 'unknown',
      requestId: req?.headers?.['x-request-id'] ?? '',
    };
  }

  @Post('orders')
  @UseGuards(ExportRateLimitGuard)
  @Permissions('EXPORT_ORDERS')
  @Audit('EXPORT_ORDERS', { targetType: 'export_job' })
  @HttpCode(HttpStatus.OK)
  async exportOrders(@Body() dto: ExportOrdersBodyDto, @Req() req: any, @Res({ passthrough: true }) res: Response) {
    const actor = this.buildActor(req);
    const result = await this.core.exportOrders(actor, dto);
    if (result.kind === 'sync') {
      // 直接返回 buffer
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(result.fileName)}"`);
      res.setHeader('Content-Length', result.buffer.length);
      // 也回传一份 audit-friendly 的元数据放 header（PUT 给审计 interceptor 不适用，直接返回 buffer）
      return new StreamableFile(result.buffer);
    }
    // 异步：返回 jobId（响应体），交给前端轮询
    return { data: { jobId: result.jobId, expectedRowCount: result.expectedRowCount, status: 'pending' } };
  }

  @Get(':jobId')
  async getJob(@Param('jobId') jobId: string, @Req() req: any) {
    const actor = this.buildActor(req);
    const job = await this.core.getJob(actor, jobId);
    return {
      data: {
        id: job.id,
        type: job.type,
        status: job.status,
        progress: job.progress,
        row_count: job.row_count,
        file_name: job.file_name,
        file_size: job.file_size,
        error_code: job.error_code,
        error_message: job.error_message,
        created_at: job.created_at,
        completed_at: job.completed_at,
      },
    };
  }

  @Get(':jobId/download')
  async download(@Param('jobId') jobId: string, @Req() req: any, @Res() res: Response) {
    const actor = this.buildActor(req);
    const meta = await this.core.getJobForDownload(actor, jobId);
    if (!fs.existsSync(meta.filePath)) {
      throw new BadRequestException({ code: 'EXPORT_FILE_MISSING', msg: '文件已被清理' });
    }
    res.setHeader('Content-Type', meta.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(meta.fileName)}"`);
    res.setHeader('Content-Length', meta.fileSize);
    fs.createReadStream(meta.filePath).pipe(res);
  }

  @Post('reports')
  @UseGuards(ExportRateLimitGuard)
  @Permissions('EXPORT_REPORT')
  @Audit('EXPORT_REPORT', { targetType: 'report' })
  @HttpCode(HttpStatus.OK)
  async exportReport(@Body() dto: ExportReportBodyDto, @Req() req: any, @Res({ passthrough: true }) res: Response) {
    const actor = this.buildActor(req);
    const result = await this.core.exportReport(actor, dto);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(result.fileName)}"`);
    res.setHeader('Content-Length', result.buffer.length);
    return new StreamableFile(result.buffer);
  }
}
