/**
 * 共享通用模块：跨业务复用的小工具
 *
 * 当前包含：
 *  - LocalImageCleanupService：本地上传图片清理
 *  - MysqlIdempotencyStore：幂等存储（P0-4）
 *
 * 此模块零业务依赖，可被任何 feature module import，不会引入循环依赖。
 */
import { Global, Module } from '@nestjs/common';
import { LocalImageCleanupService } from '@/modules/merchant-ops/common/image-cleanup';
import { MysqlIdempotencyStore, IDEMPOTENCY_STORE_TOKEN } from '@/modules/common/adapters/mysql-idempotency-store.adapter';

@Global()
@Module({
  providers: [
    LocalImageCleanupService,
    { provide: IDEMPOTENCY_STORE_TOKEN, useClass: MysqlIdempotencyStore },
  ],
  exports: [
    LocalImageCleanupService,
    IDEMPOTENCY_STORE_TOKEN,
  ],
})
export class CommonModule {}
