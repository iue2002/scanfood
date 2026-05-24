import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from '@/app.controller';
import { AppService } from '@/app.service';
import { CommonModule } from '@/modules/common/common.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { DishesModule } from '@/modules/dishes/dishes.module';
import { TablesModule } from '@/modules/tables/tables.module';
import { OrdersModule } from '@/modules/orders/orders.module';
import { CartsModule } from '@/modules/carts/carts.module';
import { StatisticsModule } from '@/modules/statistics/statistics.module';
import { RefundsModule } from '@/modules/refunds/refunds.module';
import { PrintModule } from '@/modules/print/print.module';
import { UploadModule } from '@/modules/upload/upload.module';
import { MerchantOpsModule } from '@/modules/merchant-ops/merchant-ops.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    CommonModule,
    AuthModule,
    DishesModule,
    TablesModule,
    OrdersModule,
    CartsModule,
    StatisticsModule,
    RefundsModule,
    PrintModule,
    UploadModule,
    MerchantOpsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
