import { Controller, Post, Get, Body, UseGuards, Request } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { LoginDto, RegisterDto, WechatLoginDto } from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body() dto: LoginDto) {
    console.log('[POST /api/auth/login]', dto);
    const result = await this.authService.login(dto);
    console.log('[Response]', result);
    return result;
  }

  @Post('register')
  async register(@Body() dto: RegisterDto) {
    console.log('[POST /api/auth/register]', dto);
    const result = await this.authService.register(dto);
    console.log('[Response]', result);
    return result;
  }

  @Post('wechat-login')
  async wechatLogin(@Body() dto: WechatLoginDto) {
    console.log('[POST /api/auth/wechat-login]', dto);
    const result = await this.authService.wechatLogin(dto.code);
    console.log('[Response]', result);
    return result;
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getCurrentUser(@Request() req: any) {
    return await this.authService.getUserInfo(req.user.userId);
  }
}
