import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { db } from '@/storage/database/mysql-client';
import { users, tables } from '@/storage/database/shared/schema';
import { LoginDto, RegisterDto, UpdateProfileDto, BindTableDto } from './dto/auth.dto';
import * as bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import * as https from 'https';

@Injectable()
export class AuthService {
  constructor(private readonly jwtService: JwtService) {}

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
