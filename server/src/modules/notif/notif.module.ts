/**
 * 多通道通知模块（Web Push + Email）
 *
 * - PushNotificationService：Web Push（VAPID）
 * - EmailNotificationService：SMTP 邮件（下个 commit 加）
 * - NotificationDispatcher：统一调度（按 user_preferences 决定走哪些通道）
 *
 * 由 OrdersService 在订单事件触发时调用。
 */
import { Module } from '@nestjs/common';
import { NotifController } from './notif.controller';
import { PushNotificationService } from './push.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [NotifController],
  providers: [PushNotificationService],
  exports: [PushNotificationService],
})
export class NotifModule {}
