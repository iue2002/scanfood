import { Module } from '@nestjs/common';
import { AppController } from '@/app.controller';
import { AppService } from '@/app.service';
import { AuthModule } from '@/modules/auth/auth.module';
import { DishesModule } from '@/modules/dishes/dishes.module';
import { TablesModule } from '@/modules/tables/tables.module';
import { OrdersModule } from '@/modules/orders/orders.module';
import { StatisticsModule } from '@/modules/statistics/statistics.module';
import { RefundsModule } from '@/modules/refunds/refunds.module';
import { PrintModule } from '@/modules/print/print.module';
import { UploadModule } from '@/modules/upload/upload.module';

@Module({
  imports: [
    AuthModule,
    DishesModule,
    TablesModule,
    OrdersModule,
    StatisticsModule,
    RefundsModule,
    PrintModule,
    UploadModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
