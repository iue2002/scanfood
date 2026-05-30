import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { sanitizeLog } from '@/common/log-sanitizer';

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

    const requestId = (request as any).requestId || request.headers['x-request-id'] || '';

    // P2-3：统一用 NestJS Logger，敏感字段脱敏
    if (isProduction) {
      this.logger.error(
        `[${requestId}] ${request.method} ${request.url} → ${status}: ${typeof message === 'object' ? JSON.stringify(message) : message}`,
      );
    } else if (status >= 400 && status < 500) {
      this.logger.warn(
        `[${requestId}] ${request.method} ${request.url} → ${status}: ${typeof message === 'object' ? JSON.stringify(message) : message}`,
      );
    } else {
      // 非生产 5xx：完整信息但不打印原始 body（脱敏）
      this.logger.error(
        `[${requestId}] ${request.method} ${request.url} → ${status}`,
        sanitizeLog({
          message: typeof message === 'object' ? message : String(message),
          body: request.body,
          stack: exception instanceof Error ? exception.stack?.split('\n').slice(0, 3).join('\n') : undefined,
        }),
      );
    }

    // 摊平 HttpException 的 response（可能是 string 或对象）
    const isObjectMessage =
      message !== null &&
      typeof message === 'object';

    const responseBody: Record<string, any> = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    if (isObjectMessage) {
      const obj = message as Record<string, any>;
      const innerMessage = typeof obj.message === 'string'
        ? obj.message
        : Array.isArray(obj.message)
          ? obj.message.join('；')
          : (isProduction && status >= 500 ? '服务器内部错误，请稍后重试' : '请求失败');
      const { statusCode: _sc, timestamp: _ts, path: _p, message: _m, ...rest } = obj;
      Object.assign(responseBody, rest, { message: innerMessage });
    } else {
      responseBody.message =
        isProduction && status >= 500
          ? '服务器内部错误，请稍后重试'
          : (typeof message === 'string' ? message : (exception instanceof Error ? exception.message : '请求失败'));
    }

    response.status(status).json(responseBody);
  }
}
