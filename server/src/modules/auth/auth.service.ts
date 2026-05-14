import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AuthService {
  private client = getSupabaseClient();

  // 账号密码登录
  async login(dto: LoginDto) {
    const { data, error } = await this.client
      .from('users')
      .select('*')
      .eq('username', dto.username)
      .maybeSingle();

    if (error) throw new BadRequestException(`查询用户失败: ${error.message}`);
    if (!data) throw new UnauthorizedException('用户名或密码错误');

    // 验证密码
    const isValid = await bcrypt.compare(dto.password, data.password);
    if (!isValid) throw new UnauthorizedException('用户名或密码错误');

    // 返回用户信息（不包含密码）
    const { password, ...userInfo } = data;
    return {
      user: userInfo,
      token: this.generateToken(data.id), // 简单token生成，实际应使用JWT
    };
  }

  // 用户注册
  async register(dto: RegisterDto) {
    // 检查用户名是否已存在
    const { data: existingUser } = await this.client
      .from('users')
      .select('id')
      .eq('username', dto.username)
      .maybeSingle();

    if (existingUser) throw new BadRequestException('用户名已存在');

    // 加密密码
    const hashedPassword = await bcrypt.hash(dto.password, 10);

    // 创建用户
    const { data, error } = await this.client
      .from('users')
      .insert({
        username: dto.username,
        password: hashedPassword,
        role: dto.role,
        nickname: dto.nickname || dto.username,
        avatar_url: dto.avatar_url,
      })
      .select()
      .single();

    if (error) throw new BadRequestException(`注册失败: ${error.message}`);

    const { password, ...userInfo } = data;
    return {
      user: userInfo,
      token: this.generateToken(data.id),
    };
  }

  // 微信登录（简化版，实际需要调用微信API）
  async wechatLogin(code: string) {
    // TODO: 实际应该调用微信API获取openid
    // 这里简化处理，直接使用code作为openid
    const openid = code;

    // 查找是否已有该微信用户
    const { data: existingUser } = await this.client
      .from('users')
      .select('*')
      .eq('openid', openid)
      .maybeSingle();

    if (existingUser) {
      const { password, ...userInfo } = existingUser;
      return {
        user: userInfo,
        token: this.generateToken(existingUser.id),
        isNewUser: false,
      };
    }

    // 新用户，创建账号
    const { data, error } = await this.client
      .from('users')
      .insert({
        username: `wx_${openid.substring(0, 10)}`,
        password: await bcrypt.hash(Math.random().toString(36), 10),
        role: 'customer',
        openid: openid,
        nickname: '微信用户',
      })
      .select()
      .single();

    if (error) throw new BadRequestException(`微信登录失败: ${error.message}`);

    const { password, ...userInfo } = data;
    return {
      user: userInfo,
      token: this.generateToken(data.id),
      isNewUser: true,
    };
  }

  // 获取用户信息
  async getUserInfo(userId: number) {
    const { data, error } = await this.client
      .from('users')
      .select('id, username, role, openid, nickname, avatar_url, created_at')
      .eq('id', userId)
      .maybeSingle();

    if (error) throw new BadRequestException(`获取用户信息失败: ${error.message}`);
    if (!data) throw new UnauthorizedException('用户不存在');

    return data;
  }

  // 简单token生成（实际应使用JWT）
  private generateToken(userId: number): string {
    return Buffer.from(`${userId}:${Date.now()}`).toString('base64');
  }
}
