import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { db } from '@/storage/database/mysql-client';
import { users } from '@/storage/database/shared/schema';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import * as bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';

@Injectable()
export class AuthService {
  constructor(private readonly jwtService: JwtService) {}

  async login(dto: LoginDto) {
    const result = await db.select().from(users).where(eq(users.username, dto.username));
    const user = result[0];
    if (!user) throw new UnauthorizedException('用户名或密码错误');

    const isValid = await bcrypt.compare(dto.password, user.password);
    if (!isValid) throw new UnauthorizedException('用户名或密码错误');

    const { password, ...userInfo } = user;
    return {
      user: userInfo,
      token: this.jwtService.sign({ userId: user.id, role: user.role }),
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

  async wechatLogin(code: string) {
    const openid = code;
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

    const hashedPassword = await bcrypt.hash(Math.random().toString(36), 10);
    const insertResult = await db.insert(users).values({
      username: `wx_${openid.substring(0, 10)}`,
      password: hashedPassword,
      role: 'customer',
      openid,
      nickname: '微信用户',
    });

    const newId = (insertResult as any)[0].insertId;
    const newUserResult = await db.select().from(users).where(eq(users.id, newId));
    const newUser = newUserResult[0];
    const { password, ...userInfo } = newUser;
    return {
      user: userInfo,
      token: this.jwtService.sign({ userId: newUser.id, role: newUser.role }),
      isNewUser: true,
    };
  }

  async getUserInfo(userId: number) {
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
}
