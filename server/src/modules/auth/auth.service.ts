import { Injectable, UnauthorizedException, BadRequestException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { db } from '@/storage/database/mysql-client';
import { users, tables, login_logs } from '@/storage/database/shared/schema';
import { LoginDto, RegisterDto, UpdateProfileDto, BindTableDto } from './dto/auth.dto';
import { CaptchaService } from './captcha.service';
import * as bcrypt from 'bcryptjs';
import { eq, desc, and } from 'drizzle-orm';
import * as https from 'https';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly captchaService: CaptchaService,
  ) {}

  // ===== 安全加固: 账户锁定（内存 Map） =====
  // 同一账号连续失败 MAX_FAILED_ATTEMPTS 次 → 锁定 LOCK_DURATION_MS
  private static readonly MAX_FAILED_ATTEMPTS = 5;
  private static readonly LOCK_DURATION_MS = 30 * 60 * 1000; // 30 分钟
  private static readonly FAIL_RESET_MS = 10 * 60 * 1000; // 10 分钟内连续失败才累计
  private accountLockMap = new Map<
    string,
    { failedCount: number; lockedUntil: number; lastFailAt: number }
  >();

  private isAccountLocked(username: string): { locked: boolean; remainingMinutes?: number } {
    const entry = this.accountLockMap.get(username);
    if (!entry) return { locked: false };

    // 正在锁定期内
    if (entry.lockedUntil > Date.now()) {
      const remainingMinutes = Math.ceil((entry.lockedUntil - Date.now()) / 60000);
      return { locked: true, remainingMinutes };
    }

    // 锁定已过期，但不清除 entry（保留 lastFailAt 用于判断"连续"）
    if (entry.lockedUntil > 0) {
      entry.lockedUntil = 0;
    }

    // 距离上次失败超过 FAIL_RESET_MS → 重置计数（不再连续）
    if (Date.now() - entry.lastFailAt > AuthService.FAIL_RESET_MS) {
      entry.failedCount = 0;
    }

    return { locked: false };
  }

  private recordFailedAttempt(username: string): void {
    const now = Date.now();
    let entry = this.accountLockMap.get(username);

    if (!entry) {
      entry = { failedCount: 0, lockedUntil: 0, lastFailAt: 0 };
    }

    // 距离上次失败超过 FAIL_RESET_MS → 重置计数（不连续）
    if (now - entry.lastFailAt > AuthService.FAIL_RESET_MS) {
      entry.failedCount = 0;
    }

    entry.failedCount++;
    entry.lastFailAt = now;

    if (entry.failedCount >= AuthService.MAX_FAILED_ATTEMPTS) {
      entry.lockedUntil = now + AuthService.LOCK_DURATION_MS;
      this.logger.warn(`账户已锁定: ${username}，持续 30 分钟`);
    }

    this.accountLockMap.set(username, entry);
  }

  private clearLockEntry(username: string): void {
    this.accountLockMap.delete(username);
    this.logger.log(`登录成功，已重置失败计数: ${username}`);
  }

  // 暴露给登录流程：当前用户名的累计失败次数（窗口内）
  getFailedCount(username: string): number {
    const entry = this.accountLockMap.get(username);
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
    const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${appId}&secret=${appSecret}&js_code=${code}&grant_type=authorization_code`;

    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
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
      }).on('error', (err) => {
        reject(err);
      });
    });
  }

  // ===== 登录（含锁定检查 + 审计日志 + 上次登录信息） =====
  async login(dto: LoginDto, ipAddress?: string, userAgent?: string) {
    const username = dto.username;

    // 1. 检查是否被锁定
    const lockStatus = this.isAccountLocked(username);
    if (lockStatus.locked) {
      this.logger.warn(`账户锁定拒绝: ${username}`);
      await this.recordLoginLog(null, username, ipAddress || '', userAgent || '', false, '账户已锁定');
      throw new UnauthorizedException(
        `账户已临时锁定，请 ${lockStatus.remainingMinutes} 分钟后再试`,
      );
    }

    // 2. 验证码：失败 1 次后必须验证（业界主流策略：失败一次就上 captcha）
    const failed = this.getFailedCount(username);
    if (failed >= 1) {
      const passed = this.captchaService.verify(dto.captchaToken || '', dto.captchaInput || '');
      if (!passed) {
        // captcha 错误不计入密码失败次数，但要返回标志让前端刷新验证码
        const err: any = new UnauthorizedException('验证码错误或已过期，请重新获取');
        err.response = { ...err.response, captchaRequired: true };
        throw err;
      }
    }

    // 3. 查找用户
    const result = await db.select().from(users).where(eq(users.username, username));
    const user = result[0];

    if (!user) {
      this.recordFailedAttempt(username);
      await this.recordLoginLog(null, username, ipAddress || '', userAgent || '', false, '用户名或密码错误');
      const err: any = new UnauthorizedException('用户名或密码错误');
      err.response = { ...err.response, captchaRequired: true };
      throw err;
    }

    // 4. 验证密码
    const isValid = await bcrypt.compare(dto.password, user.password);
    if (!isValid) {
      this.recordFailedAttempt(username);
      await this.recordLoginLog(user.id, username, ipAddress || '', userAgent || '', false, '用户名或密码错误');
      const err: any = new UnauthorizedException('用户名或密码错误');
      err.response = { ...err.response, captchaRequired: true };
      throw err;
    }

    // 5. 登录成功：清除锁定 + 记录审计
    this.clearLockEntry(username);
    await this.recordLoginLog(user.id, username, ipAddress || '', userAgent || '', true);

    // 6. 获取上次登录信息
    const lastLogin = await this.getLastLogin(user.id);

    const { password, ...userInfo } = user;
    return {
      user: userInfo,
      token: this.jwtService.sign({ userId: user.id, role: user.role }),
      last_login: lastLogin || undefined,
    };
  }

  async register(dto: RegisterDto) {
    const existing = await db.select().from(users).where(eq(users.username, dto.username));
    if (existing.length > 0) throw new BadRequestException('用户名已存在');

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const insertResult = await db.insert(users).values({
      username: dto.username,
      password: hashedPassword,
      role: dto.role,
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
    console.log('获取到openid:', openid);
    
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
    console.log('新用户，开始自动注册');
    const hashedPassword = await bcrypt.hash(Math.random().toString(36), 10);
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
    console.log('新用户注册成功:', newUser.id);
    return {
      user: userInfo,
      token: this.jwtService.sign({ userId: newUser.id, role: newUser.role }),
      isNewUser: true,
    };
  }

  async updateProfile(userId: number, dto: UpdateProfileDto) {
    const updateData: any = {};
    if (dto.nickname !== undefined) updateData.nickname = dto.nickname;
    if (dto.avatar_url !== undefined) updateData.avatar_url = dto.avatar_url;

    if (Object.keys(updateData).length === 0) {
      throw new BadRequestException('没有需要更新的字段');
    }

    await db.update(users).set(updateData).where(eq(users.id, userId));

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
