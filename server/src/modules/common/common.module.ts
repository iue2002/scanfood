/**
 * 共享通用模块：跨业务复用的小工具
 *
 * 当前包含：
 *  - LocalImageCleanupService：本地上传图片清理（删除/更新业务对象时清理本地图片文件）
 *
 * 此模块零业务依赖，可被任何 feature module import，不会引入循环依赖。
 */
import { Global, Module } from '@nestjs/common';
import { LocalImageCleanupService } from '@/modules/merchant-ops/common/image-cleanup';

@Global()
@Module({
  providers: [LocalImageCleanupService],
  exports: [LocalImageCleanupService],
})
export class CommonModule {}
