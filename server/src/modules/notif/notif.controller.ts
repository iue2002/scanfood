/**
 * 多通道通知 Controller（Web Push + Email + 群机器人）
 * 路由前缀：/api/notif
 *
 * 权限分层：
 *   1. push 订阅 - 任意登录用户（个人通道）
 *   2. email 测试 - owner / manager / admin
 *   3. robot 配置 - owner / manager / admin（店铺级共享通道）
 */
import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
  HttpCode,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PushNotificationService } from './push.service';
import { EmailNotificationService } from './email.service';
import { RobotNotificationService, ALL_ROBOT_PROVIDERS } from './robot.service';
import type { RobotProvider } from './robot.service';
import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsOptional,
  IsEmail,
  IsIn,
  IsBoolean,
  IsArray,
  ArrayMaxSize,
} from 'class-validator';

class SubscribePushDto {
  @IsString() @IsNotEmpty() @MaxLength(500)
  endpoint!: string;
  @IsString() @IsNotEmpty() @MaxLength(255)
  p256dh!: string;
  @IsString() @IsNotEmpty() @MaxLength(255)
  auth!: string;
  @IsOptional() @IsString() @MaxLength(500)
  user_agent?: string;
}

class UnsubscribePushDto {
  @IsString() @IsNotEmpty() @MaxLength(500)
  endpoint!: string;
}

class TestEmailDto {
  @IsEmail({}, { message: '收件邮箱格式不合法' })
  @MaxLength(255)
  to!: string;
  @IsOptional() @IsIn(['platform', 'custom'])
  mode?: 'platform' | 'custom';
}

class UpsertRobotDto {
  @IsBoolean()
  enabled!: boolean;
  /** 明文 webhook URL；首次必填，更新时可留空沿用旧值 */
  @IsOptional() @IsString() @MaxLength(1000)
  webhook_url?: string;
  /** 明文签名密钥；钉钉/飞书可选，企微无 */
  @IsOptional() @IsString() @MaxLength(255)
  secret?: string;
  @IsArray() @ArrayMaxSize(8)
  @IsIn(['NEW_ORDER', 'ADD_ITEM', 'REFUND'], { each: true })
  events!: ('NEW_ORDER' | 'ADD_ITEM' | 'REFUND')[];
}

const ADMIN_ROLES = new Set(['owner', 'manager', 'admin']);
const VALID_PROVIDERS: ReadonlySet<RobotProvider> = new Set(ALL_ROBOT_PROVIDERS);

function assertAdmin(req: any) {
  const role = req?.user?.role;
  if (!role || !ADMIN_ROLES.has(role)) {
    throw new ForbiddenException({ code: 'FORBIDDEN', msg: '仅店主/经理可操作' });
  }
}

function assertProvider(p: string): asserts p is RobotProvider {
  if (!VALID_PROVIDERS.has(p as RobotProvider)) {
    throw new BadRequestException({ code: 'INVALID_PROVIDER', msg: '未知的机器人类型' });
  }
}

@Controller('notif')
export class NotifController {
  constructor(
    private readonly pushService: PushNotificationService,
    private readonly emailService: EmailNotificationService,
    private readonly robotService: RobotNotificationService,
  ) {}

  // ==================== Web Push ====================

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

  // ==================== Email ====================

  @UseGuards(JwtAuthGuard)
  @Post('email/test')
  @HttpCode(200)
  async testEmail(@Body() dto: TestEmailDto, @Req() req: any) {
    assertAdmin(req);
    const r = await this.emailService.testConnection(dto.to, dto.mode || 'platform');
    return r.ok
      ? { success: true, message: '测试邮件已发送，请检查收件箱' }
      : { success: false, message: r.reason || '邮件发送失败' };
  }

  // ==================== 群机器人 ====================

  /** 列出当前店铺所有 provider 的配置（脱敏） */
  @UseGuards(JwtAuthGuard)
  @Get('robots')
  async listRobots(@Req() req: any) {
    assertAdmin(req);
    const data = await this.robotService.listConfigs(1);
    return { success: true, data };
  }

  /** 保存（INSERT or UPDATE）某 provider 的配置 */
  @UseGuards(JwtAuthGuard)
  @Put('robots/:provider')
  async upsertRobot(
    @Param('provider') provider: string,
    @Body() dto: UpsertRobotDto,
    @Req() req: any,
  ) {
    assertAdmin(req);
    assertProvider(provider);
    try {
      const data = await this.robotService.upsertConfig({
        storeId: 1,
        provider,
        enabled: dto.enabled,
        webhookUrl: dto.webhook_url,
        secret: dto.secret,
        events: dto.events,
      });
      return { success: true, data };
    } catch (err: any) {
      throw new BadRequestException({ code: 'INVALID_ROBOT_CONFIG', msg: err?.message || '保存失败' });
    }
  }

  /** 删除某 provider 配置 */
  @UseGuards(JwtAuthGuard)
  @Delete('robots/:provider')
  async deleteRobot(@Param('provider') provider: string, @Req() req: any) {
    assertAdmin(req);
    assertProvider(provider);
    return this.robotService.removeConfig(provider, 1);
  }

  /** 测试发送 */
  @UseGuards(JwtAuthGuard)
  @Post('robots/:provider/test')
  @HttpCode(200)
  async testRobot(@Param('provider') provider: string, @Req() req: any) {
    assertAdmin(req);
    assertProvider(provider);
    const r = await this.robotService.testSend(provider, 1);
    return r.ok
      ? { success: true, message: '测试消息已发送，请检查群里是否收到' }
      : { success: false, message: r.reason || '发送失败' };
  }
}
