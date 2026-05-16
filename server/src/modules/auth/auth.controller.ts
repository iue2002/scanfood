import { Controller, Post, Get, Body, UseGuards, Request } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { LoginDto, RegisterDto, WechatLoginDto, UpdateProfileDto } from './dto/auth.dto';

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
    const result = await this.authService.wechatLogin(dto.code, dto.nickname, dto.avatar_url);
    console.log('[Response]', result);
    return result;
  }

  @Post('update-profile')
  @UseGuards(JwtAuthGuard)
  async updateProfile(@Request() req: any, @Body() dto: UpdateProfileDto) {
    const result = await this.authService.updateProfile(req.user.userId, dto);
    return result;
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getCurrentUser(@Request() req: any) {
    return await this.authService.getUserInfo(req.user.userId);
  }
}
