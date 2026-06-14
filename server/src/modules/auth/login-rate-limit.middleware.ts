import { Injectable, NestMiddleware } from '@nestjs/common';
import rateLimit from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';

// 登录接口专用限流器：同一 IP 每 15 分钟最多 5 次失败尝试
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 分钟窗口
  max: 5,                       // 最多 5 次
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    statusCode: 429,
    message: '登录尝试过于频繁，请 15 分钟后再试',
  },
  skipSuccessfulRequests: false,
});

@Injectable()
export class LoginRateLimitMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    loginLimiter(req, res, next);
  }
}

// 注册接口专用限流器：同一 IP 每 15 分钟最多 3 次注册（注册是低频操作，比登录更严）
// 防止脚本批量创建账号
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    statusCode: 429,
    message: '注册过于频繁，请 15 分钟后再试',
  },
  skipSuccessfulRequests: false,
});

@Injectable()
export class RegisterRateLimitMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    registerLimiter(req, res, next);
  }
}
