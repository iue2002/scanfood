import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosResponse } from 'axios';
import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

interface CompressionResult {
  success: boolean;
  data?: {
    url: string;
    originalSize: number;
    compressedSize: number;
    compressionRatio: number;
    fellbackToOriginal?: boolean;  // 压缩后比原图还大时回退到原图
  };
  message?: string;
}

@Injectable()
export class TinifyService {
  private readonly logger = new Logger(TinifyService.name);
  private readonly apiKey: string;
  private readonly uploadDir = 'uploads';
  private readonly baseUrl = 'https://api.tinify.com';
  // 缩短至 12s（用户体验 vs 网络抖动妥协；Tinify 平均 2-3s）
  private readonly tinifyTimeoutMs = 12_000;

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('TINIFY_API_KEY', '');
  }

  async compressImage(file: Express.Multer.File): Promise<CompressionResult> {
    if (!this.apiKey) {
      return {
        success: false,
        message: '未配置 Tinify API 密钥',
      };
    }
    if (!file?.buffer || file.buffer.length === 0) {
      return { success: false, message: '上传文件为空' };
    }

    try {
      const auth = Buffer.from(`api:${this.apiKey}`).toString('base64');

      // 1) Shrink: 上传到 Tinify
      const uploadResponse = await axios.post(
        `${this.baseUrl}/shrink`,
        file.buffer,
        {
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': file.mimetype,
          },
          timeout: this.tinifyTimeoutMs,
        },
      );

      const location = uploadResponse.headers.location as string;
      const inputSize = uploadResponse.data?.input?.size ?? file.size;
      const outputSize = uploadResponse.data?.output?.size ?? 0;

      if (!location) {
        return {
          success: false,
          message: 'Tinify API 未返回压缩后的图片地址',
        };
      }

      // 2) Download: 拉回压缩产物
      const downloadResponse: AxiosResponse<Buffer> = await axios.get(location, {
        headers: { Authorization: `Basic ${auth}` },
        responseType: 'arraybuffer',
        timeout: this.tinifyTimeoutMs,
      });

      // 3) 写盘（异步 fs.promises，不阻塞 event loop）
      await fs.mkdir(this.uploadDir, { recursive: true });
      const ext = path.extname(file.originalname) || '.jpg';
      const filename = `compressed_${uuidv4()}${ext}`;
      const filePath = path.join(this.uploadDir, filename);

      // 4) 防御：如果压缩后比原图大（PNG 透明 / 已压缩 JPEG 偶发场景），回退原图
      const compressed = downloadResponse.data;
      const useCompressed = compressed.length < file.buffer.length;
      const finalBuffer = useCompressed ? compressed : file.buffer;
      await fs.writeFile(filePath, finalBuffer);

      const finalSize = finalBuffer.length;
      const compressionRatio = useCompressed && inputSize > 0
        ? Math.round((1 - finalSize / inputSize) * 100)
        : 0;

      if (!useCompressed) {
        this.logger.warn(`[tinify] 压缩后(${compressed.length})比原图(${file.buffer.length})大，已回退原图：${filename}`);
      }

      return {
        success: true,
        data: {
          url: `/uploads/${filename}`,
          originalSize: inputSize || file.buffer.length,
          compressedSize: finalSize,
          compressionRatio,
          fellbackToOriginal: !useCompressed,
        },
      };
    } catch (error: any) {
      const errorMessage = this.parseError(error);
      this.logger.warn(`[tinify] 压缩失败: ${errorMessage}`);
      return {
        success: false,
        message: errorMessage,
      };
    }
  }

  private parseError(error: any): string {
    if (error?.response) {
      const status = error.response.status;
      // Tinify 错误响应 body 是 ArrayBuffer 时（download 出错），尝试解析
      let bodyMsg = '';
      try {
        const data = error.response.data;
        if (Buffer.isBuffer(data)) {
          const txt = data.toString('utf8');
          const parsed = JSON.parse(txt);
          bodyMsg = parsed?.message || parsed?.error || '';
        } else {
          bodyMsg = data?.message || data?.error || '';
        }
      } catch {
        bodyMsg = '未知错误';
      }
      const message = bodyMsg || '未知错误';

      switch (status) {
        case 401:
          return `Tinify API 认证失败：${message}`;
        case 402:
          return 'Tinify API 调用次数已超限，请稍后再试';
        case 415:
          return `不支持的图片格式：${message}`;
        case 500:
        case 502:
        case 503:
        case 504:
          return 'Tinify API 服务暂时不可用';
        default:
          return `Tinify API 调用失败 (${status})：${message}`;
      }
    } else if (error.code === 'ECONNABORTED') {
      return '图片压缩请求超时，请重试';
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'EAI_AGAIN') {
      return '无法连接到 Tinify API 服务器';
    } else {
      return `图片压缩失败：${error?.message || '未知错误'}`;
    }
  }
}
