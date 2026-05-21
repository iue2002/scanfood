import { Controller, Post, Get, Body, UseGuards, Request, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { CaptchaService } from './captcha.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { LoginDto, RegisterDto, WechatLoginDto, UpdateProfileDto, BindTableDto } from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly captchaService: CaptchaService,
  ) {}

  // 验证码图片：返回 { token, svg }，svg 是 SVG 字符串可直接 dangerouslySetInnerHTML
  @Get('captcha')
  getCaptcha() {
    return this.captchaService.generate();
  }

  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: any) {
    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || req.ip
      || req.connection?.remoteAddress
      || '';
    const userAgent = (req.headers['user-agent'] as string) || '';
    console.log('[POST /api/auth/login]', { username: dto.username, ip: ipAddress });
    const result = await this.authService.login(dto, ipAddress, userAgent);
    console.log('[Response]', { userId: result.user?.id, hasLastLogin: !!result.last_login });
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

  @Get('verify')
  @UseGuards(JwtAuthGuard)
  async verifyToken(@Request() req: any) {
    const user = await this.authService.getUserInfo(req.user.userId);
    return { user };
  }

  @Post('bind-table')
  @UseGuards(JwtAuthGuard)
  async bindTable(@Request() req: any, @Body() dto: BindTableDto) {
    console.log('[POST /api/auth/bind-table]', dto);
    const result = await this.authService.bindTable(req.user.userId, dto);
    console.log('[Response]', result);
    return result;
  }
}
