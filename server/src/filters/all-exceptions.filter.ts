import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

const isProduction = process.env.NODE_ENV === 'production';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : exception;

    // 生产环境只记录简略信息，不记录 body 和 stack 以防泄露敏感数据
    if (isProduction) {
      this.logger.error(
        `[${request.method}] ${request.url} → ${status}: ${typeof message === 'object' ? JSON.stringify(message) : message}`,
      );
    } else {
      // 开发环境记录完整信息便于调试
      console.error('全局异常捕获:', {
        status,
        message,
        path: request.url,
        method: request.method,
        body: request.body,
        stack: exception instanceof Error ? exception.stack : undefined,
      });
    }

    // 生产环境返回通用错误消息，开发环境返回详细消息
    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message: isProduction && status >= 500
        ? '服务器内部错误，请稍后重试'
        : message,
    });
  }
}
