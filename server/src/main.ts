import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from '@/app.module';
import * as express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import * as cookieParser from 'cookie-parser';
import { HttpStatusInterceptor } from '@/interceptors/http-status.interceptor';
import { RequestIdInterceptor } from '@/interceptors/request-id.interceptor';
import { AllExceptionsFilter } from '@/filters/all-exceptions.filter';
import { OrdersGateway } from '@/modules/orders/orders.gateway';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

function parsePort(): number {
  const args = process.argv.slice(2);
  const portIndex = args.indexOf('-p');
  if (portIndex !== -1 && args[portIndex + 1]) {
    const port = parseInt(args[portIndex + 1], 10);
    if (!isNaN(port) && port > 0 && port < 65536) {
      return port;
    }
  }
  return 3000;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // cookie 解析：用于 JWT cookie 兜底传输 + 验证码 token 等
  app.use(cookieParser());

  // ===== 安全加固: CORS 白名单 =====
  // 仅允许已知域名跨域请求，禁止任意 origin
  app.enableCors({
    origin: [
      'https://www.ali88.online',
      'https://servicewechat.com',       // 微信小程序
      'https://localhost:5173',           // 商家端本地开发（HTTPS）
      'http://localhost:5173',            // 商家端本地开发（HTTP）
      'http://localhost:3000',            // 本地调试
      'http://127.0.0.1:5173',
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,                        // 预检请求缓存 24h
  });

  // ===== 安全加固: Helmet 安全头 =====
  // 防止 XSS、点击劫持、MIME 嗅探等攻击
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },  // 允许跨域加载图片
    contentSecurityPolicy: false,  // CSP 由 Nginx 层统一管理
  }));

  // ===== 安全加固: 全局限流 =====
  // 每个 IP 每分钟最多 120 次请求，防止 DoS / 暴力攻击
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      max: 120,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        statusCode: 429,
        message: '请求过于频繁，请稍后再试',
      },
      skip: (req) => {
        // WebSocket 升级请求和静态文件不限流
        return req.url?.startsWith('/ws') || req.url?.startsWith('/uploads');
      },
    }),
  );

  // 静态文件服务：上传的图片
  const uploadsDir = join(process.cwd(), 'uploads');
  if (!existsSync(uploadsDir)) {
    mkdirSync(uploadsDir, { recursive: true });
  }
  app.use('/uploads', express.static(uploadsDir, {
    maxAge: '30d',
    etag: true,
    lastModified: true,
  }));

  app.setGlobalPrefix('api');
  // 限制请求体大小为 10MB，防止大 payload 攻击
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));

  // ===== 安全加固: 全局 ValidationPipe =====
  // DTO 白名单校验，自动剥离未定义字段，防止参数污染和注入
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,              // 剥离 DTO 未定义的字段
      forbidNonWhitelisted: true,   // 拒绝携带未知字段的请求
      transform: true,              // 自动类型转换
      transformOptions: { enableImplicitConversion: true },
      disableErrorMessages: process.env.NODE_ENV === 'production',  // 生产环境隐藏详细校验错误
    }),
  );

  // P2-3：全局请求 ID 拦截器（在所有模块生效）
  app.useGlobalInterceptors(new RequestIdInterceptor());
  // 全局拦截器：统一将 POST 请求的 201 状态码改为 200
  app.useGlobalInterceptors(new HttpStatusInterceptor());
  // 全局异常过滤器（已使用 Logger + 脱敏，不再打印敏感信息）
  app.useGlobalFilters(new AllExceptionsFilter());
  // 开启优雅关闭 Hooks
  app.enableShutdownHooks();

  // 解析端口
  const port = parsePort();
  try {
    const httpServer = app.getHttpServer();
    await app.listen(port);

    // 初始化 WebSocket 服务器
    const ordersGateway = app.get(OrdersGateway);
    ordersGateway.init(httpServer);
    const logger = new Logger('Bootstrap');
    logger.log(`Server running on http://localhost:${port} (WebSocket: ws://localhost:${port}/ws)`);
  } catch (err) {
    if ((err as any).code === 'EADDRINUSE') {
      const logger = new Logger('Bootstrap');
      logger.error(`端口 ${port} 被占用! 请运行 'npx kill-port ${port}' 然后重试。`);
      process.exit(1);
    } else {
      throw err;
    }
  }
}
bootstrap();
