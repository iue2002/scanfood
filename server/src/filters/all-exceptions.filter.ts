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
    } else if (status >= 400 && status < 500) {
      // 开发环境：4xx 客户端错误是业务正常情况（认证失败/参数错/未找到），
      // 只打一行简洁日志，不打 stack（避免 stack 噪音淹没真正的 500 异常）
      console.warn(`[${status}] ${request.method} ${request.url} → ${typeof message === 'object' ? JSON.stringify(message) : message}`);
    } else {
      // 开发环境 5xx 或其他：完整信息便于调试
      console.error('全局异常捕获:', {
        status,
        message,
        path: request.url,
        method: request.method,
        body: request.body,
        stack: exception instanceof Error ? exception.stack : undefined,
      });
    }

    // 摊平 HttpException 的 response（可能是 string 或对象）
    // 避免 message 字段嵌套对象 → 前端渲染时 React 报"object is not valid as React child"
    const isObjectMessage =
      message !== null &&
      typeof message === 'object';

    const responseBody: Record<string, any> = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    if (isObjectMessage) {
      // 对象类型 response：把 message 字段提取出来当 message，其它字段并到顶层
      const obj = message as Record<string, any>;
      const innerMessage = typeof obj.message === 'string'
        ? obj.message
        : Array.isArray(obj.message)
          ? obj.message.join('；')
          : (isProduction && status >= 500 ? '服务器内部错误，请稍后重试' : '请求失败');
      // 排除会冲突的 statusCode/timestamp/path
      const { statusCode: _sc, timestamp: _ts, path: _p, message: _m, ...rest } = obj;
      Object.assign(responseBody, rest, { message: innerMessage });
    } else {
      // string/number/Error 等基本类型
      responseBody.message =
        isProduction && status >= 500
          ? '服务器内部错误，请稍后重试'
          : (typeof message === 'string' ? message : (exception instanceof Error ? exception.message : '请求失败'));
    }

    response.status(status).json(responseBody);
  }
}
