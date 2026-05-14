import { Controller, Post, Get, Body, UseGuards, Request } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto, WechatLoginDto } from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // 账号密码登录
  @Post('login')
  async login(@Body() dto: LoginDto) {
    console.log('[POST /api/auth/login]', dto);
    const result = await this.authService.login(dto);
    console.log('[Response]', result);
    return result;
  }

  // 用户注册
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    console.log('[POST /api/auth/register]', dto);
    const result = await this.authService.register(dto);
    console.log('[Response]', result);
    return result;
  }

  // 微信登录
  @Post('wechat-login')
  async wechatLogin(@Body() dto: WechatLoginDto) {
    console.log('[POST /api/auth/wechat-login]', dto);
    const result = await this.authService.wechatLogin(dto.code);
    console.log('[Response]', result);
    return result;
  }

  // 获取当前用户信息（需要token）
  @Get('me')
  async getCurrentUser(@Request() req: any) {
    // TODO: 从请求头获取token并验证
    // 这里简化处理
    return { message: '需要实现JWT验证' };
  }
}
