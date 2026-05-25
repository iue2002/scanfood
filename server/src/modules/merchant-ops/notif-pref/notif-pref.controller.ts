import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/modules/auth/jwt-auth.guard';
import { Audit } from '../auth/decorators';
import { NotifPrefCore } from './notif-pref.core';
import { UpdateNotifPrefDto } from './notif-pref.dto';

/**
 * 通知偏好接口
 *
 * Validates: Requirements 9.2, 9.3, 9.4
 */
@Controller('merchant-ops/notification-preferences')
@UseGuards(JwtAuthGuard)
export class NotifPrefController {
  constructor(private readonly core: NotifPrefCore) {}

  /** R9.2: 返回当前用户偏好（无记录返回默认值） */
  @Get('me')
  async getMine(@Req() req: any) {
    const userId = req?.user?.userId;
    const row = await this.core.getOrDefault(userId);
    return { data: row };
  }

  /** R9.3: 更新当前用户偏好 */
  @Put('me')
  @Audit('NOTIF_PREF_UPDATE', { targetType: 'user_preference' })
  async updateMine(@Req() req: any, @Body() dto: UpdateNotifPrefDto) {
    const userId = req?.user?.userId;
    const row = await this.core.upsert(userId, {
      sound_enabled: dto.sound_enabled,
      sound_id: dto.sound_id,
      desktop_events: dto.desktop_events,
      // 邮件字段可选；不传时保留旧值
      ...(dto.email !== undefined ? { email: dto.email } : {}),
      ...(dto.email_events !== undefined ? { email_events: dto.email_events } : {}),
    });
    return { data: row };
  }

  /** R9.4: 内置音色清单 */
  @Get('sounds')
  async listSounds() {
    const sounds = await this.core.listSounds();
    return { data: sounds };
  }
}
