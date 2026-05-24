import { Module } from '@nestjs/common';
import { DishesController } from './dishes.controller';
import { DishesService } from './dishes.service';
import { AuthModule } from '../auth/auth.module';
import { MerchantOpsModule } from '../merchant-ops/merchant-ops.module';

@Module({
  imports: [AuthModule, MerchantOpsModule],
  controllers: [DishesController],
  providers: [DishesService],
  exports: [DishesService],
})
export class DishesModule {}
