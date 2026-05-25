import { Module } from '@nestjs/common';
import { StoreSettingsService } from './store-settings.service';
import { StoreSettingsController } from './store-settings.controller';
import { AuthModule } from '../auth/auth.module';
import { AesEncryptorService } from '@/modules/merchant-ops/print/aes-encryptor';

/**
 * AesEncryptorService 在此模块本地 provide：
 * 它是无状态封装（只读 .env AES_KEY），多实例之间无副作用，
 * 不必跨模块导出避免循环依赖（merchant-ops 也独立 provide 同一个 class）
 */
@Module({
  imports: [AuthModule],
  controllers: [StoreSettingsController],
  providers: [StoreSettingsService, AesEncryptorService],
  exports: [StoreSettingsService],
})
export class StoreSettingsModule {}
