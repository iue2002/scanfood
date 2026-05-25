/**
 * 多通道通知 Controller（Web Push + Email）
 * 路由前缀：/api/notif
 *
 * 职责：
 *   1. POST /push/subscribe   – 前端 PushSubscription 上报
 *   2. POST /push/unsubscribe – 取消订阅
 *   3. GET  /push/vapid-key   – 前端拿公钥
 *   4. GET  /push/subscriptions – 当前用户订阅列表
 *   5. POST /email/test       – 发测试邮件验证 SMTP（owner / manager / admin）
 */
import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  UseGuards,
  HttpCode,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PushNotificationService } from './push.service';
import { EmailNotificationService } from './email.service';
import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsOptional,
  IsEmail,
  IsIn,
} from 'class-validator';

class SubscribePushDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  endpoint!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  p256dh!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  auth!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  user_agent?: string;
}

class UnsubscribePushDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  endpoint!: string;
}

class TestEmailDto {
  @IsEmail({}, { message: '收件邮箱格式不合法' })
  @MaxLength(255)
  to!: string;

  @IsOptional()
  @IsIn(['platform', 'custom'])
  mode?: 'platform' | 'custom';
}

const ADMIN_ROLES = new Set(['owner', 'manager', 'admin']);

@Controller('notif')
export class NotifController {
  constructor(
    private readonly pushService: PushNotificationService,
    private readonly emailService: EmailNotificationService,
  ) {}

  @Get('push/vapid-key')
  async getVapidPublicKey() {
    return {
      enabled: this.pushService.isEnabled(),
      publicKey: this.pushService.getPublicKey(),
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('push/subscribe')
  @HttpCode(200)
  async subscribePush(@Body() dto: SubscribePushDto, @Req() req: any) {
    const userId = req?.user?.userId;
    if (!userId) throw new BadRequestException('未授权');
    if (!this.pushService.isEnabled()) {
      throw new BadRequestException('服务端未配置 VAPID，无法订阅 Web Push');
    }
    return this.pushService.subscribe({
      userId,
      endpoint: dto.endpoint,
      p256dh: dto.p256dh,
      auth: dto.auth,
      userAgent: dto.user_agent,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post('push/unsubscribe')
  @HttpCode(200)
  async unsubscribePush(@Body() dto: UnsubscribePushDto, @Req() req: any) {
    const userId = req?.user?.userId;
    if (!userId) throw new BadRequestException('未授权');
    return this.pushService.unsubscribe(userId, dto.endpoint);
  }

  @UseGuards(JwtAuthGuard)
  @Get('push/subscriptions')
  async listMySubscriptions(@Req() req: any) {
    const userId = req?.user?.userId;
    if (!userId) throw new BadRequestException('未授权');
    const subs = await this.pushService.listByUser(userId);
    return { data: subs };
  }

  /**
   * POST /api/notif/email/test
   * 发一封测试邮件验证 SMTP 配置
   * 权限：owner / manager / admin
   */
  @UseGuards(JwtAuthGuard)
  @Post('email/test')
  @HttpCode(200)
  async testEmail(@Body() dto: TestEmailDto, @Req() req: any) {
    const role = req?.user?.role;
    if (!role || !ADMIN_ROLES.has(role)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', msg: '仅店主/经理可测试邮件配置' });
    }
    const r = await this.emailService.testConnection(dto.to, dto.mode || 'platform');
    return r.ok
      ? { success: true, message: '测试邮件已发送，请检查收件箱' }
      : { success: false, message: r.reason || '邮件发送失败' };
  }
}
