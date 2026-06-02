import { Injectable, UnauthorizedException, BadRequestException, Logger, Inject } from '@nestjs/common';
import { TTL_STORE_TOKEN } from '@/modules/common/adapters/mysql-ttl-store.adapter';
import type { TtlStorePort } from '@/modules/common/ports/ttl-store.port';
import { JwtService } from '@nestjs/jwt';
import { db } from '@/storage/database/mysql-client';
import { users, tables, login_logs } from '@/storage/database/shared/schema';
import { LoginDto, RegisterDto, UpdateProfileDto, BindTableDto } from './dto/auth.dto';
import { CaptchaService } from './captcha.service';
import * as bcrypt from 'bcryptjs';
import { eq, desc, and } from 'drizzle-orm';
import * as https from 'https';
import { LocalImageCleanupService } from '@/modules/merchant-ops/common/image-cleanup';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly captchaService: CaptchaService,
    private readonly imageCleanup: LocalImageCleanupService,
    @Inject(TTL_STORE_TOKEN)
    private readonly lockStore: TtlStorePort,
  ) {}

  // ===== 安全加固: 账户锁定（MySQL TTL Store，P1-2） =====
  private static readonly MAX_FAILED_ATTEMPTS = 5;
  private static readonly LOCK_DURATION_MS = 30 * 60 * 1000;
  private static readonly FAIL_RESET_MS = 10 * 60 * 1000;

  private lockKey(username: string): string {
    return `login:lock:${username}`;
  }

  private async isAccountLocked(username: string): Promise<{ locked: boolean; remainingMinutes?: number }> {
    const entry = await this.lockStore.get<{ failedCount: number; lockedUntil: number; lastFailAt: number }>(this.lockKey(username));
    if (!entry) return { locked: false };

    if (entry.lockedUntil > Date.now()) {
      const remainingMinutes = Math.ceil((entry.lockedUntil - Date.now()) / 60000);
      return { locked: true, remainingMinutes };
    }

    if (Date.now() - entry.lastFailAt > AuthService.FAIL_RESET_MS) {
      entry.failedCount = 0;
    }

    return { locked: false };
  }

  private async recordFailedAttempt(username: string): Promise<void> {
    const now = Date.now();
    const key = this.lockKey(username);
    let entry = await this.lockStore.get<{ failedCount: number; lockedUntil: number; lastFailAt: number }>(key) ||
      { failedCount: 0, lockedUntil: 0, lastFailAt: 0 };

    if (now - entry.lastFailAt > AuthService.FAIL_RESET_MS) {
      entry.failedCount = 0;
    }

    entry.failedCount++;
    entry.lastFailAt = now;

    if (entry.failedCount >= AuthService.MAX_FAILED_ATTEMPTS) {
      entry.lockedUntil = now + AuthService.LOCK_DURATION_MS;
      this.logger.warn(`账户已锁定: ${username}，持续 30 分钟`);
    }

    await this.lockStore.set(key, entry, AuthService.LOCK_DURATION_MS);
  }

  private async clearLockEntry(username: string): Promise<void> {
    await this.lockStore.delete(this.lockKey(username));
    this.logger.log(`登录成功，已重置失败计数: ${username}`);
  }

  async getFailedCount(username: string): Promise<number> {
    const entry = await this.lockStore.get<{ failedCount: number; lockedUntil: number; lastFailAt: number }>(this.lockKey(username));
    if (!entry) return 0;
    if (Date.now() - entry.lastFailAt > AuthService.FAIL_RESET_MS) return 0;
    return entry.failedCount;
  }

  // ===== 审计日志（写入 DB，失败不影响主流程） =====
  private async recordLoginLog(
    userId: number | null,
    username: string,
    ipAddress: string,
    userAgent: string,
    success: boolean,
    failureReason?: string,
  ): Promise<void> {
    try {
      await db.insert(login_logs).values({
        user_id: userId,
        username,
        ip_address: ipAddress || null,
        user_agent: userAgent || null,
        success: success ? 1 : 0,
        failure_reason: failureReason || null,
      });
    } catch (err) {
      this.logger.error(`登录日志写入失败: ${(err as Error).message}`);
    }
  }

  // ===== 查询上次成功登录 =====
  private async getLastLogin(userId: number): Promise<{ at: string; ip: string } | null> {
    try {
      const result = await db
        .select({ created_at: login_logs.created_at, ip_address: login_logs.ip_address })
        .from(login_logs)
        .where(and(eq(login_logs.user_id, userId), eq(login_logs.success, 1)))
        .orderBy(desc(login_logs.created_at))
        .limit(2);

      if (result.length >= 2) {
        return {
          at: new Date(result[1].created_at).toISOString(),
          ip: result[1].ip_address || '未知',
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  async getOpenIdFromCode(code: string): Promise<string> {
    const appId = process.env.WX_APP_ID || process.env.WECHAT_APPID;
    const appSecret = process.env.WX_APP_SECRET || process.env.WECHAT_APPSECRET;
    // 缺失凭据直接报错，避免把 undefined 拼进 URL 后拿到一个无意义的微信错误
    if (!appId || !appSecret) {
      throw new BadRequestException('微信登录未配置（缺少 WX_APP_ID / WX_APP_SECRET）');
    }
    if (!code) {
      throw new BadRequestException('缺少 code');
    }
    // 参数编码，防止特殊字符破坏 URL
    const qs =
      `appid=${encodeURIComponent(appId)}` +
      `&secret=${encodeURIComponent(appSecret)}` +
      `&js_code=${encodeURIComponent(code)}` +
      `&grant_type=authorization_code`;
    const url = `https://api.weixin.qq.com/sns/jscode2session?${qs}`;

    return new Promise((resolve, reject) => {
      const req = https.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (result.errcode) {
              reject(new Error(`微信API错误: ${result.errmsg}`));
            } else {
              resolve(result.openid);
            }
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on('error', (err) => {
        reject(err);
      });
      // 10s 硬超时：微信 API 无响应时避免请求悬挂
      req.setTimeout(10_000, () => {
        req.destroy(new Error('微信 jscode2session 请求超时'));
      });
    });
  }

  // ===== 登录（含锁定检查 + 审计日志 + 上次登录信息） =====
  async login(dto: LoginDto, ipAddress?: string, userAgent?: string) {
    const username = dto.username;

    // 1. 检查是否被锁定
    const lockStatus = await this.isAccountLocked(username);
    if (lockStatus.locked) {
      this.logger.warn(`账户锁定拒绝: ${username}`);
      await this.recordLoginLog(null, username, ipAddress || '', userAgent || '', false, '账户已锁定');
      throw new UnauthorizedException(
        `账户已临时锁定，请 ${lockStatus.remainingMinutes} 分钟后再试`,
      );
    }

    // 2. 验证码：失败 1 次后必须验证
    const failed = await this.getFailedCount(username);
    if (failed >= 1) {
      const passed = await this.captchaService.verify(dto.captchaToken || '', dto.captchaInput || '');
      if (!passed) {
        await this.recordLoginLog(null, username, ipAddress || '', userAgent || '', false, '验证码错误');
        // 用对象作为 UnauthorizedException 的 response，NestJS 会原样序列化输出 captchaRequired 字段
        throw new UnauthorizedException({
          statusCode: 401,
          message: '验证码错误或已过期，请重新获取',
          captchaRequired: true,
        });
      }
    }

    // 3. 查找用户
    const result = await db.select().from(users).where(eq(users.username, username));
    const user = result[0];

    if (!user) {
      await this.recordFailedAttempt(username);
      await this.recordLoginLog(null, username, ipAddress || '', userAgent || '', false, '用户名或密码错误');
      throw new UnauthorizedException({
        statusCode: 401,
        message: '用户名或密码错误',
        captchaRequired: (await this.getFailedCount(username)) >= 1,
      });
    }

    // 4. 验证密码
    const isValid = await bcrypt.compare(dto.password, user.password);
    if (!isValid) {
      await this.recordFailedAttempt(username);
      await this.recordLoginLog(user.id, username, ipAddress || '', userAgent || '', false, '用户名或密码错误');
      throw new UnauthorizedException({
        statusCode: 401,
        message: '用户名或密码错误',
        captchaRequired: (await this.getFailedCount(username)) >= 1,
      });
    }

    // 5. 登录成功：清除锁定 + 记录审计
    await this.clearLockEntry(username);
    await this.recordLoginLog(user.id, username, ipAddress || '', userAgent || '', true);

    // 6. 检查账号状态（merchant-ops M1）
    if ((user as any).status === 'deleted' || (user as any).status === 'disabled') {
      throw new UnauthorizedException({
        statusCode: 401,
        message: '账号已被禁用或删除',
      });
    }

    // 7. 获取上次登录信息
    const lastLogin = await this.getLastLogin(user.id);

    const { password, ...userInfo } = user;
    return {
      user: userInfo,
      // 带上 token_version 用于强制下线（merchant-ops M1）
      token: this.jwtService.sign({
        userId: user.id,
        role: user.role,
        token_version: (user as any).token_version ?? 0,
      }),
      last_login: lastLogin || undefined,
      // 临时密码后必须改密（M1）
      requirePasswordChange: !!(user as any).must_change_password,
    };
  }

  async register(dto: RegisterDto) {
    const existing = await db.select().from(users).where(eq(users.username, dto.username));
    if (existing.length > 0) throw new BadRequestException('用户名已存在');

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const insertResult = await db.insert(users).values({
      username: dto.username,
      password: hashedPassword,
      role: 'customer',
      nickname: dto.nickname || dto.username,
      avatar_url: dto.avatar_url,
    });

    const newId = (insertResult as any)[0].insertId;
    const newUserResult = await db.select().from(users).where(eq(users.id, newId));
    const newUser = newUserResult[0];
    const { password, ...userInfo } = newUser;
    return {
      user: userInfo,
      token: this.jwtService.sign({ userId: newUser.id, role: newUser.role }),
    };
  }

  async wechatLogin(code: string, nickname?: string, avatar_url?: string) {
    const openid = await this.getOpenIdFromCode(code);
    this.logger.debug(`微信登录 openid: ${openid.substring(0, 6)}***`);

    if (!openid || openid.startsWith('local_') || !/^[0-9A-Za-z_-]{16,64}$/.test(openid)) {
      throw new BadRequestException('openid 无效');
    }
    
    // 根据openid查找用户，如果找不到则自动注册
    const existing = await db.select().from(users).where(eq(users.openid, openid));
    if (existing.length > 0) {
      const user = existing[0];
      const { password, ...userInfo } = user;
      return {
        user: userInfo,
        token: this.jwtService.sign({ userId: user.id, role: user.role }),
        isNewUser: false,
      };
    }

    // 新用户自动注册
    this.logger.log('新用户自动注册');
    const hashedPassword = await bcrypt.hash(Math.random().toString(36), 10);
    try {
      const insertResult = await db.insert(users).values({
        username: `wx_${openid.substring(0, 10)}`,
        password: hashedPassword,
        role: 'customer',
        openid,
        nickname: nickname || '微信用户',
        avatar_url: avatar_url || '',
      });

      const newId = (insertResult as any)[0].insertId;
      const newUserResult = await db.select().from(users).where(eq(users.id, newId));
      const newUser = newUserResult[0];
      const { password, ...userInfo } = newUser;
      this.logger.log(`新用户自动注册成功 userId=${newUser.id}`);
      return {
        user: userInfo,
        token: this.jwtService.sign({ userId: newUser.id, role: newUser.role }),
        isNewUser: true,
      };
    } catch (err: any) {
      // 可能是并发导致 openid 已被插入，回查后复用
      if (err?.code === 'ER_DUP_ENTRY') {
        const again = await db.select().from(users).where(eq(users.openid, openid));
        if (again.length > 0) {
          const user = again[0];
          const { password, ...userInfo } = user;
          return {
            user: userInfo,
            token: this.jwtService.sign({ userId: user.id, role: user.role }),
            isNewUser: false,
          };
        }
      }
      throw err;
    }
  }

  async updateProfile(userId: number, dto: UpdateProfileDto) {
    const updateData: any = {};
    if (dto.nickname !== undefined) updateData.nickname = dto.nickname;
    if (dto.avatar_url !== undefined) updateData.avatar_url = dto.avatar_url;

    if (Object.keys(updateData).length === 0) {
      throw new BadRequestException('没有需要更新的字段');
    }

    // 头像替换：先记录旧值，update 后清理旧文件（fire-and-forget）
    let oldAvatar: string | null = null;
    if (dto.avatar_url !== undefined) {
      const cur = await db
        .select({ avatar_url: users.avatar_url })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      oldAvatar = cur[0]?.avatar_url ?? null;
    }

    await db.update(users).set(updateData).where(eq(users.id, userId));

    if (oldAvatar && oldAvatar !== dto.avatar_url) {
      void this.imageCleanup.removeByUrl(oldAvatar);
    }

    const result = await db.select({
      id: users.id,
      username: users.username,
      role: users.role,
      openid: users.openid,
      nickname: users.nickname,
      avatar_url: users.avatar_url,
      created_at: users.created_at,
    }).from(users).where(eq(users.id, userId));

    const user = result[0];
    if (!user) throw new UnauthorizedException('用户不存在');
    return user;
  }

  async getUserInfo(userId: number) {
    const result = await db.select({
      id: users.id,
      username: users.username,
      role: users.role,
      openid: users.openid,
      nickname: users.nickname,
      avatar_url: users.avatar_url,
      table_number: users.table_number,
      created_at: users.created_at,
    }).from(users).where(eq(users.id, userId));

    const user = result[0];
    if (!user) throw new UnauthorizedException('用户不存在');
    return user;
  }

  async bindTable(userId: number, dto: BindTableDto) {
    const tableResult = await db.select().from(tables).where(eq(tables.table_number, dto.tableNumber));
    const table = tableResult[0];
    if (!table) throw new BadRequestException('桌台不存在');

    await db.update(users).set({ table_number: table.table_number }).where(eq(users.id, userId));

    return { tableNumber: table.table_number };
  }
}
