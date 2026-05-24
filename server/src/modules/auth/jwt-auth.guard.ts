import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * JWT 认证守卫
 *
 * 重写 handleRequest：把 passport 默认的笼统 'Unauthorized' 升级成
 * 带 code 的 UnauthorizedException，方便前端按原因区分处理（toast / 引导文案）。
 *
 * Code 体系：
 *   - TOKEN_MISSING     缺失 Authorization header
 *   - TOKEN_EXPIRED     JWT 自然过期（exp 到了）
 *   - TOKEN_INVALID     签名验证失败（密钥 rotate / 篡改 / 格式错）
 *   - SESSION_REVOKED   token_version 不匹配（被强制下线）— 由 jwt.strategy.ts 抛出
 *   - ACCOUNT_DISABLED  账号被禁用 / 删除 — 由 jwt.strategy.ts 抛出
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  /**
   * info 来自 passport-jwt 验签流程：
   *   - TokenExpiredError → exp 过期
   *   - JsonWebTokenError → 签名错 / 格式错
   *   - 'No auth token'   → 没传 Authorization
   * err 来自 jwt.strategy.ts validate() 抛出的（自带 code）
   */
  handleRequest<TUser = any>(err: any, user: any, info: any, _ctx: ExecutionContext, _status?: any): TUser {
    // strategy.validate() 主动抛错（已经是带 code 的 UnauthorizedException）
    if (err) throw err;

    if (user) return user as TUser;

    // passport 拦下的：根据 info 区分原因
    const name = info?.name || info?.constructor?.name;
    const message = info?.message || '';

    if (name === 'TokenExpiredError') {
      throw new UnauthorizedException({ code: 'TOKEN_EXPIRED', msg: '登录已过期，请重新登录' });
    }
    if (name === 'JsonWebTokenError') {
      throw new UnauthorizedException({ code: 'TOKEN_INVALID', msg: '登录信息无效（系统已更新），请重新登录' });
    }
    if (message.includes('No auth token')) {
      throw new UnauthorizedException({ code: 'TOKEN_MISSING', msg: '请先登录' });
    }
    // 兜底
    throw new UnauthorizedException({ code: 'TOKEN_INVALID', msg: '认证失败，请重新登录' });
  }
}
