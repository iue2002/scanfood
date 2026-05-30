import { Controller, Post, UseInterceptors, UploadedFile, BadRequestException, UseGuards, Req } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage, memoryStorage } from 'multer';
import { extname } from 'path';
import { readFile, unlink } from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { ImageProcessorService } from './image-processor.service';
import { ImageAssetService } from './image-asset.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

const uploadDir = 'uploads';

// P1-5：移除 svg+xml（SVG 可携带脚本，存在 XSS 风险）
const ALLOWED_MIMES = /\/(jpg|jpeg|png|gif|webp|heic|heif|tiff?|avif|bmp)$/;

/** P1-5：魔数字节签名校验，防止 MIME 类型伪造 */
const MAGIC_SIGNATURES: Record<string, ReadonlyArray<number>> = {
  'image/jpeg': [0xFF, 0xD8, 0xFF],
  'image/png':  [0x89, 0x50, 0x4E, 0x47],
  'image/gif':  [0x47, 0x49, 0x46, 0x38],
  'image/webp': [0x52, 0x49, 0x46, 0x46], // RIFF....WEBP
  'image/bmp':  [0x42, 0x4D],
  'image/tiff': [0x49, 0x49, 0x2A, 0x00], // little-endian
  'image/tif':  [0x49, 0x49, 0x2A, 0x00],
  'image/avif': [0x00, 0x00, 0x00, 0x1C], // ftypavif（粗略匹配前 4 字节）
};

/** TIFF big-endian 备用签名 */
const TIFF_BE = [0x4D, 0x4D, 0x00, 0x2A];

function validateMagicBytes(mime: string, bytes: Uint8Array): boolean {
  const sig = MAGIC_SIGNATURES[mime];
  if (!sig) return true; // 不在白名单的类型不校验（heic/heif 无标准魔数前缀）

  // 特殊处理：TIFF 支持 LE 和 BE 两种字节序
  if (mime === 'image/tiff' || mime === 'image/tif') {
    const headLE = sig.every((b, i) => bytes[i] === b);
    const headBE = TIFF_BE.every((b, i) => bytes[i] === b);
    return headLE || headBE;
  }

  return sig.every((b, i) => bytes[i] === b);
}

@Controller('upload')
@UseGuards(JwtAuthGuard)
export class UploadController {
  constructor(
    private readonly imageProcessor: ImageProcessorService,
    private readonly imageAsset: ImageAssetService,
  ) {}

  /**
   * 原图直传端点（保留兼容性）
   * - admin-web 在压缩失败 fallback 时使用
   * - 其他场景（小程序头像等）也可能用
   */
  @Post('image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: uploadDir,
        filename: (req, file, callback) => {
          const uniqueName = `${uuidv4()}${extname(file.originalname)}`;
          callback(null, uniqueName);
        },
      }),
      fileFilter: (req, file, callback) => {
        if (!file.mimetype.match(ALLOWED_MIMES)) {
          return callback(new BadRequestException('只允许上传图片文件（不支持 SVG）'), false);
        }
        callback(null, true);
      },
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async uploadImage(@UploadedFile() file: Express.Multer.File, @Req() req: any) {
    if (!file) {
      throw new BadRequestException('上传失败');
    }

    // P1-5：魔数校验（读已落盘的图片头）
    try {
      const fd = await readFile(file.path, { encoding: null });
      const head = new Uint8Array(fd.buffer.slice(0, 16));
      if (!validateMagicBytes(file.mimetype, head)) {
        await unlink(file.path).catch(() => {});
        throw new BadRequestException('图片格式与声明不匹配，上传被拒绝');
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      await unlink(file.path).catch(() => {});
      throw new BadRequestException('图片校验失败');
    }

    // P1-5：写 image_assets 元数据（fire-and-forget）
    this.imageAsset.record({
      url: `/uploads/${file.filename}`,
      mime: file.mimetype,
      originalSizeBytes: file.size,
      outputFormat: extname(file.originalname).replace('.', ''),
      ownerUserId: req?.user?.userId,
      source: 'upload',
    });

    return {
      url: `/uploads/${file.filename}`,
      name: file.filename,
      size: file.size,
    };
  }

  /**
   * 智能压缩端点
   * - 用 sharp(libvips) 本地处理：输出主图 1280px WebP + 缩略图 480px WebP
   * - 接收 JPG/PNG/WebP/GIF/TIFF/AVIF/HEIC 等多格式（SVG 已移除）
   * - 返回字段保持向后兼容
   */
  @Post('compress')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      fileFilter: (req, file, callback) => {
        if (!file.mimetype.match(ALLOWED_MIMES)) {
          return callback(new BadRequestException('只允许上传图片文件（不支持 SVG）'), false);
        }
        callback(null, true);
      },
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async compressImage(@UploadedFile() file: Express.Multer.File, @Req() req: any) {
    if (!file) {
      throw new BadRequestException('上传失败');
    }

    // P1-5：魔数校验
    const head = new Uint8Array(file.buffer.slice(0, 16));
    if (!validateMagicBytes(file.mimetype, head)) {
      throw new BadRequestException('图片格式与声明不匹配，上传被拒绝');
    }

    const result = await this.imageProcessor.processImage(file);

    if (result.success && result.data) {
      // P1-5：写 image_assets 元数据（fire-and-forget）
      this.imageAsset.record({
        url: result.data.url,
        thumbnailUrl: result.data.thumbnailUrl,
        mime: file.mimetype,
        originalSizeBytes: result.data.originalSize,
        compressedSizeBytes: result.data.compressedSize,
        mainWidth: result.data.mainWidth,
        mainHeight: result.data.mainHeight,
        outputFormat: result.data.format,
        ownerUserId: req?.user?.userId,
        source: 'compress-upload',
      });

      return {
        success: true,
        data: result.data,
      };
    } else {
      return {
        success: false,
        message: result.message,
        allowOriginalUpload: true,
      };
    }
  }
}
