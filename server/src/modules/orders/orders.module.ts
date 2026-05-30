import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrdersGateway } from './orders.gateway';
import { OutboxScheduler } from './outbox.scheduler';
import { StoreSettingsModule } from '../store-settings/store-settings.module';
import { AuthModule } from '../auth/auth.module';
import { NotifModule } from '../notif/notif.module';

@Module({
  imports: [StoreSettingsModule, AuthModule, NotifModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersGateway, OutboxScheduler],
  exports: [OrdersService, OrdersGateway],
})
export class OrdersModule {}
