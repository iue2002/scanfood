/**
 * 多通道通知模块（Web Push + Email）
 *
 * - PushNotificationService：Web Push（VAPID）
 * - EmailNotificationService：SMTP 邮件（双模式：platform / custom）
 * - NotificationDispatcherService：统一调度（按 user_preferences 决定走哪些通道）
 *
 * 由 OrdersService / RefundsService 在订单事件触发时调用。
 *
 * AesEncryptorService 在此模块独立 provide：它是无状态封装（只读 .env AES_KEY），
 * 多实例之间无副作用，无需跨模块导入。
 */
import { Module } from '@nestjs/common';
import { NotifController } from './notif.controller';
import { PushNotificationService } from './push.service';
import { EmailNotificationService } from './email.service';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { AuthModule } from '../auth/auth.module';
import { AesEncryptorService } from '../merchant-ops/print/aes-encryptor';

@Module({
  imports: [AuthModule],
  controllers: [NotifController],
  providers: [
    PushNotificationService,
    EmailNotificationService,
    NotificationDispatcherService,
    AesEncryptorService,
  ],
  exports: [
    PushNotificationService,
    EmailNotificationService,
    NotificationDispatcherService,
  ],
})
export class NotifModule {}
