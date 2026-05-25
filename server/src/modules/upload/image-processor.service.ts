import { Injectable, Logger } from '@nestjs/common';
import * as sharp from 'sharp';
import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

/**
 * 图片处理结果
 *
 * 保持与旧 TinifyService 兼容的字段：success / data.url / data.originalSize /
 * data.compressedSize / data.compressionRatio。
 *
 * 新增 thumbnailUrl 字段（可选），admin-web 收到时取它做列表缩略图，
 * 不收到时回退到 url（向后兼容）。
 */
export interface ImageProcessResult {
  success: boolean;
  message?: string;
  data?: {
    url: string;
    thumbnailUrl: string;
    originalSize: number;
    compressedSize: number;
    compressionRatio: number;
    mainWidth: number;
    mainHeight: number;
    format: string;
  };
}

const UPLOAD_DIR = 'uploads';

// 极致但不糊的参数（实测菜品图 q80 ≈ JPEG q90 视觉，离糊还有 30+ 安全档）
const MAIN_MAX_DIM = 1280;
const MAIN_QUALITY = 80;
const THUMB_MAX_DIM = 480;
const THUMB_QUALITY = 75;
// libvips effort：0~6，数值越大压得越狠（多花几十毫秒换更小体积）
const WEBP_EFFORT = 6;

// 安全限制
const MAX_PIXEL_DIMENSION = 12000; // 单边 px 上限，防 libvips OOM
const MAX_INPUT_BYTES = 10 * 1024 * 1024; // 10MB（multer 也会拦，这里二次保险）

@Injectable()
export class ImageProcessorService {
  private readonly logger = new Logger(ImageProcessorService.name);

  /**
   * 启动期校验 sharp 可加载（main.ts 会调用）
   * 失败时抛错让应用启动失败，避免运行时才发现 native 二进制问题
   */
  static assertReady(): void {
    if (!(sharp as any).versions || !(sharp as any).versions.vips) {
      throw new Error('sharp/libvips not available—check `npm install sharp` on this platform');
    }
  }

  /**
   * 处理上传的图片：输出主图 + 缩略图（统一 WebP）
   *
   * 接收：JPG / PNG / WebP / GIF（取首帧）/ TIFF / SVG / AVIF
   * 输出：xxx.webp（主图 1280px q80）+ xxx_thumb.webp（缩略图 480px q75）
   */
  async processImage(file: Express.Multer.File): Promise<ImageProcessResult> {
    const startedAt = Date.now();

    try {
      if (!file || !file.buffer) {
        return { success: false, message: '上传文件缺失' };
      }

      if (file.buffer.length > MAX_INPUT_BYTES) {
        return { success: false, message: `图片超过 ${MAX_INPUT_BYTES / 1024 / 1024} MB 上限` };
      }

      // 1. 用 sharp 读元数据，校验是真实图片
      let metadata: sharp.Metadata;
      try {
        metadata = await sharp(file.buffer).metadata();
      } catch {
        return { success: false, message: '图片格式无法识别或已损坏' };
      }

      if (!metadata.width || !metadata.height) {
        return { success: false, message: '图片尺寸无法识别' };
      }

      if (metadata.width > MAX_PIXEL_DIMENSION || metadata.height > MAX_PIXEL_DIMENSION) {
        return {
          success: false,
          message: `图片单边像素超过 ${MAX_PIXEL_DIMENSION}px 上限，请先缩小`,
        };
      }

      // 2. 准备输出路径
      const id = uuidv4();
      const mainName = `${id}.webp`;
      const thumbName = `${id}_thumb.webp`;
      const mainPath = path.join(UPLOAD_DIR, mainName);
      const thumbPath = path.join(UPLOAD_DIR, thumbName);

      // 确保目录存在
      await fs.mkdir(UPLOAD_DIR, { recursive: true });

      // 3. 同时生成主图 + 缩略图
      // 注意：从 buffer 重新建 pipeline，因为 sharp pipeline 不可重用
      const [mainBuf, thumbBuf] = await Promise.all([
        sharp(file.buffer)
          .rotate() // EXIF 方向自动校正
          .resize({
            width: MAIN_MAX_DIM,
            height: MAIN_MAX_DIM,
            fit: 'inside',
            withoutEnlargement: true,
          })
          .webp({ quality: MAIN_QUALITY, effort: WEBP_EFFORT })
          .toBuffer({ resolveWithObject: true }),
        sharp(file.buffer)
          .rotate()
          .resize({
            width: THUMB_MAX_DIM,
            height: THUMB_MAX_DIM,
            fit: 'inside',
            withoutEnlargement: true,
          })
          .webp({ quality: THUMB_QUALITY, effort: WEBP_EFFORT })
          .toBuffer({ resolveWithObject: true }),
      ]);

      // 4. 原子写盘：写主图 → 写缩略图，任一失败则清理
      try {
        await fs.writeFile(mainPath, mainBuf.data);
      } catch (err) {
        this.logger.error(`主图写盘失败: ${(err as Error).message}`);
        return { success: false, message: '图片保存失败（磁盘错误）' };
      }

      try {
        await fs.writeFile(thumbPath, thumbBuf.data);
      } catch (err) {
        // 主图已写，但缩略图失败 → 清理主图
        await fs.unlink(mainPath).catch(() => {});
        this.logger.error(`缩略图写盘失败: ${(err as Error).message}`);
        return { success: false, message: '图片保存失败（磁盘错误）' };
      }

      const originalSize = file.buffer.length;
      const compressedSize = mainBuf.data.length;
      const compressionRatio = originalSize > 0
        ? Math.round((1 - compressedSize / originalSize) * 100)
        : 0;

      const durationMs = Date.now() - startedAt;
      this.logger.log(
        `[image] processed: ${originalSize}B → ${compressedSize}B (${compressionRatio}%), ` +
        `main=${mainBuf.info.width}x${mainBuf.info.height}, ` +
        `thumb=${thumbBuf.info.width}x${thumbBuf.info.height}, ${durationMs}ms`,
      );

      return {
        success: true,
        data: {
          url: `/uploads/${mainName}`,
          thumbnailUrl: `/uploads/${thumbName}`,
          originalSize,
          compressedSize,
          compressionRatio,
          mainWidth: mainBuf.info.width,
          mainHeight: mainBuf.info.height,
          format: 'webp',
        },
      };
    } catch (err) {
      const msg = (err as Error)?.message || '未知错误';
      this.logger.warn(`[image] 处理失败: ${msg}`);
      return { success: false, message: `图片处理失败：${msg}` };
    }
  }
}
