import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { db } from '@/storage/database/mysql-client';
import { imageAssets } from '@/storage/database/shared/schema';

export interface ImageAssetRecord {
  url: string;
  thumbnailUrl?: string;
  mime: string;
  originalSizeBytes: number;
  compressedSizeBytes?: number;
  mainWidth?: number;
  mainHeight?: number;
  outputFormat?: string;
  ownerUserId?: number;
  source?: string;
}

/**
 * ImageAssetService：上传图片元数据记录服务（P1-5）
 *
 * 每次成功上传图片后，fire-and-forget 写入 image_assets 表。
 * 写入失败不阻塞上传流程（仅记日志）。
 */
@Injectable()
export class ImageAssetService {
  private readonly logger = new Logger(ImageAssetService.name);

  /**
   * 记录一张新上传的图片资源
   * fire-and-forget 模式：不阻塞上传主流程
   */
  record(asset: ImageAssetRecord): void {
    void this._doRecord(asset);
  }

  private async _doRecord(asset: ImageAssetRecord): Promise<void> {
    try {
      await db.insert(imageAssets).values({
        url: asset.url,
        thumbnail_url: asset.thumbnailUrl ?? null,
        mime: asset.mime,
        original_size_bytes: asset.originalSizeBytes,
        compressed_size_bytes: asset.compressedSizeBytes ?? null,
        main_width: asset.mainWidth ?? null,
        main_height: asset.mainHeight ?? null,
        output_format: asset.outputFormat ?? null,
        owner_user_id: asset.ownerUserId ?? null,
        source: asset.source ?? 'upload',
      });
    } catch (err: any) {
      this.logger.warn(`[image-asset] 写入元数据失败: ${err?.message}`);
    }
  }

  /**
   * 软删除图片资源（标记 deleted_at）
   * @param url 图片 URL（如 /uploads/xxx.webp）
   */
  async markDeleted(url: string): Promise<void> {
    try {
      await db
        .update(imageAssets)
        .set({ deleted_at: new Date() })
        .where(eq(imageAssets.url, url));
    } catch (err: any) {
      this.logger.warn(`[image-asset] 软删除失败: ${err?.message}`);
    }
  }
}
