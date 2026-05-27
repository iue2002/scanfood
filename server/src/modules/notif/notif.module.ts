/**
 * 多通道通知模块（Web Push + Email + 群机器人）
 *
 * - PushNotificationService：Web Push（VAPID）
 * - EmailNotificationService：SMTP 邮件（双模式：platform / custom）
 * - RobotNotificationService：钉钉 / 企业微信 / 飞书 群机器人
 * - NotificationDispatcherService：统一调度（按 user_preferences + robot_webhooks）
 *
 * 由 OrdersService / RefundsService 在订单事件触发时调用。
 *
 * AesEncryptorService 在此模块独立 provide（无状态封装，多实例无副作用）。
 */
import { Module } from '@nestjs/common';
import { NotifController } from './notif.controller';
import { PushNotificationService } from './push.service';
import { EmailNotificationService } from './email.service';
import { RobotNotificationService } from './robot.service';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { NotifTemplateController } from './notif-template/notif-template.controller';
import { NotifTemplateCore } from './notif-template/notif-template.core';
import { DrizzleNotifTemplateRepo } from './notif-template/notif-template.repo.drizzle';
import { NOTIF_TEMPLATE_REPO_TOKEN } from './notif-template/notif-template.repo.port';
import { AuthModule } from '../auth/auth.module';
import { AesEncryptorService } from '../merchant-ops/print/aes-encryptor';

@Module({
  imports: [AuthModule],
  controllers: [NotifController, NotifTemplateController],
  providers: [
    PushNotificationService,
    EmailNotificationService,
    RobotNotificationService,
    NotificationDispatcherService,
    AesEncryptorService,
    { provide: NOTIF_TEMPLATE_REPO_TOKEN, useClass: DrizzleNotifTemplateRepo },
    { provide: NotifTemplateCore, useFactory: (repo) => new NotifTemplateCore(repo), inject: [NOTIF_TEMPLATE_REPO_TOKEN] },
  ],
  exports: [
    PushNotificationService,
    EmailNotificationService,
    RobotNotificationService,
    NotificationDispatcherService,
    NotifTemplateCore,
  ],
})
export class NotifModule {}
