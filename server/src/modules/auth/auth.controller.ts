import { Controller, Post, Get, Body, UseGuards, Request, Req, Logger } from '@nestjs/common';
import { AuthService } from './auth.service';
import { CaptchaService } from './captcha.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { LoginDto, RegisterDto, WechatLoginDto, UpdateProfileDto, BindTableDto } from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly captchaService: CaptchaService,
  ) {}

  // 验证码图片：返回 { token, svg }，svg 是 SVG 字符串可直接 dangerouslySetInnerHTML
  @Get('captcha')
  async getCaptcha() {
    return await this.captchaService.generate();
  }

  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: any) {
    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || req.ip
      || req.connection?.remoteAddress
      || '';
    const userAgent = (req.headers['user-agent'] as string) || '';
    const result = await this.authService.login(dto, ipAddress, userAgent);
    this.logger.debug(`用户登录 userId=${result.user?.id}`);
    return result;
  }

  @Post('register')
  async register(@Body() dto: RegisterDto) {
    const result = await this.authService.register(dto);
    return result;
  }

  @Post('wechat-login')
  async wechatLogin(@Body() dto: WechatLoginDto) {
    const result = await this.authService.wechatLogin(dto.code, dto.nickname, dto.avatar_url);
    this.logger.debug(`微信登录 isNewUser=${result.isNewUser} userId=${result.user?.id}`);
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
    const result = await this.authService.bindTable(req.user.userId, dto);
    return result;
  }
}
