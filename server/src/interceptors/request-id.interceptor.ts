/**
 * RequestIdInterceptor — P2-3：全局请求 ID 拦截器
 *
 * - 从 X-Request-Id header 读取或生成 UUID v4
 * - 设置响应 X-Request-Id header
 * - 所有下游模块可通过 req.headers['x-request-id'] 或 req['requestId'] 获取
 */
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { randomUUID } from 'crypto';

@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const requestId = request.headers['x-request-id'] || randomUUID();

    // 同时挂到 req 对象上，方便下游不用每次都从 headers 取
    request.requestId = requestId;
    request.headers['x-request-id'] = requestId;

    const response = context.switchToHttp().getResponse();
    response.setHeader('X-Request-Id', requestId);

    return next.handle();
  }
}
