/**
 * 多通道通知模块（Web Push + Email）
 *
 * - PushNotificationService：Web Push（VAPID）
 * - EmailNotificationService：SMTP 邮件（双模式：platform / custom）
 * - NotificationDispatcher：统一调度（按 user_preferences 决定走哪些通道）— 下个 commit 加
 *
 * 由 OrdersService 在订单事件触发时调用。
 *
 * AesEncryptorService 在此模块独立 provide：它是无状态封装（只读 .env AES_KEY），
 * 多实例之间无副作用，无需跨模块导入。
 */
import { Module } from '@nestjs/common';
import { NotifController } from './notif.controller';
import { PushNotificationService } from './push.service';
import { EmailNotificationService } from './email.service';
import { AuthModule } from '../auth/auth.module';
import { AesEncryptorService } from '../merchant-ops/print/aes-encryptor';

@Module({
  imports: [AuthModule],
  controllers: [NotifController],
  providers: [PushNotificationService, EmailNotificationService, AesEncryptorService],
  exports: [PushNotificationService, EmailNotificationService],
})
export class NotifModule {}
