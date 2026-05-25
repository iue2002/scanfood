import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrdersGateway } from './orders.gateway';
import { StoreSettingsModule } from '../store-settings/store-settings.module';
import { AuthModule } from '../auth/auth.module';
import { NotifModule } from '../notif/notif.module';

@Module({
  imports: [StoreSettingsModule, AuthModule, NotifModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersGateway],
  exports: [OrdersService, OrdersGateway],
})
export class OrdersModule {}
