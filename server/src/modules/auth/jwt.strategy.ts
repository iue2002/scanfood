import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { db } from '@/storage/database/mysql-client';
import { users } from '@/storage/database/shared/schema';
import { eq } from 'drizzle-orm';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'default-secret',
    });
  }

  async validate(payload: any) {
    // ====== merchant-ops-center M1：强制下线（token_version 校验） ======
    // 仅当 payload 里携带了 token_version 时才校验，保持对旧 token 的向后兼容
    if (payload?.token_version !== undefined && payload?.token_version !== null) {
      const userId = payload.userId ?? payload.sub;
      if (userId) {
        const rows = await db.select({
          token_version: users.token_version,
          status: users.status,
        }).from(users).where(eq(users.id, userId)).limit(1);
        const u = rows[0];
        if (!u) {
          throw new UnauthorizedException({ code: 'SESSION_REVOKED', msg: '账号不存在或已删除' });
        }
        if (u.status === 'deleted' || u.status === 'disabled') {
          throw new UnauthorizedException({ code: 'SESSION_REVOKED', msg: '账号已被禁用或删除' });
        }
        if (u.token_version !== payload.token_version) {
          throw new UnauthorizedException({ code: 'SESSION_REVOKED', msg: '会话已失效，请重新登录' });
        }
      }
    }
    return {
      userId: payload.userId ?? payload.sub,
      role: payload.role,
      token_version: payload.token_version,
    };
  }
}
