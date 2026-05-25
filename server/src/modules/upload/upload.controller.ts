import { Controller, Post, UseInterceptors, UploadedFile, BadRequestException, UseGuards } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage, memoryStorage } from 'multer';
import { extname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { ImageProcessorService } from './image-processor.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

const uploadDir = 'uploads';

// 允许的 MIME（含 HEIC——前端会先用 heic2any 转 JPG，但服务端也兜底）
const ALLOWED_MIMES = /\/(jpg|jpeg|png|gif|webp|heic|heif|tiff?|svg\+xml|avif|bmp)$/;

@Controller('upload')
@UseGuards(JwtAuthGuard)
export class UploadController {
  constructor(private readonly imageProcessor: ImageProcessorService) {}

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
          return callback(new BadRequestException('只允许上传图片文件'), false);
        }
        callback(null, true);
      },
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('上传失败');
    }
    return {
      url: `/uploads/${file.filename}`,
      name: file.filename,
      size: file.size,
    };
  }

  /**
   * 智能压缩端点（替换原 Tinify 实现）
   * - 用 sharp(libvips) 本地处理：输出主图 1280px WebP + 缩略图 480px WebP
   * - 接收 JPG/PNG/WebP/GIF/TIFF/SVG/AVIF/HEIC 等多格式
   * - 返回字段保持向后兼容：success/data.url/originalSize/compressedSize/compressionRatio
   * - 新增 thumbnailUrl 字段（admin/小程序按需消费）
   * - 失败时返回 allowOriginalUpload=true 维持现有"是否继续上传原图"弹窗交互
   */
  @Post('compress')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(), // 在内存里给 sharp 处理，不落临时文件
      fileFilter: (req, file, callback) => {
        if (!file.mimetype.match(ALLOWED_MIMES)) {
          return callback(new BadRequestException('只允许上传图片文件'), false);
        }
        callback(null, true);
      },
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async compressImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('上传失败');
    }

    const result = await this.imageProcessor.processImage(file);

    if (result.success) {
      return {
        success: true,
        data: result.data,
      };
    } else {
      return {
        success: false,
        message: result.message,
        allowOriginalUpload: true, // 让 admin-web 的"是否继续上传原图"弹窗仍可工作
      };
    }
  }
}
