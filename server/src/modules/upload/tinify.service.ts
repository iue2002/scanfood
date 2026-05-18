import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosResponse } from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

interface CompressionResult {
  success: boolean;
  data?: {
    url: string;
    originalSize: number;
    compressedSize: number;
    compressionRatio: number;
  };
  message?: string;
}

@Injectable()
export class TinifyService {
  private readonly apiKey: string;
  private readonly uploadDir = 'uploads';
  private readonly baseUrl = 'https://api.tinify.com';

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

    try {
      const auth = Buffer.from(`api:${this.apiKey}`).toString('base64');

      const uploadResponse = await axios.post(
        `${this.baseUrl}/shrink`,
        file.buffer,
        {
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': file.mimetype,
          },
          timeout: 30000,
        },
      );

      const location = uploadResponse.headers.location as string;
      const inputSize = uploadResponse.data.input?.size || file.size;
      const outputSize = uploadResponse.data.output?.size || 0;

      if (!location) {
        return {
          success: false,
          message: 'Tinify API 未返回压缩后的图片地址',
        };
      }

      const downloadResponse: AxiosResponse<Buffer> = await axios.get(location, {
        headers: {
          Authorization: `Basic ${auth}`,
        },
        responseType: 'arraybuffer',
        timeout: 30000,
      });

      if (!fs.existsSync(this.uploadDir)) {
        fs.mkdirSync(this.uploadDir, { recursive: true });
      }

      const ext = path.extname(file.originalname) || '.jpg';
      const filename = `compressed_${uuidv4()}${ext}`;
      const filePath = path.join(this.uploadDir, filename);

      fs.writeFileSync(filePath, downloadResponse.data);

      const compressionRatio = outputSize > 0 && inputSize > 0
        ? Math.round((1 - outputSize / inputSize) * 100)
        : 0;

      return {
        success: true,
        data: {
          url: `/uploads/${filename}`,
          originalSize: inputSize,
          compressedSize: downloadResponse.data.length,
          compressionRatio,
        },
      };
    } catch (error: any) {
      const errorMessage = this.parseError(error);
      return {
        success: false,
        message: errorMessage,
      };
    }
  }

  private parseError(error: any): string {
    if (error.response) {
      const status = error.response.status;
      const message = error.response.data?.message || error.response.data?.error || '未知错误';

      switch (status) {
        case 401:
          return `Tinify API 认证失败：${message}`;
        case 402:
          return 'Tinify API 调用次数已超限，请稍后再试';
        case 415:
          return `不支持的图片格式：${message}`;
        case 500:
          return 'Tinify API 服务内部错误';
        default:
          return `Tinify API 调用失败 (${status})：${message}`;
      }
    } else if (error.code === 'ECONNABORTED') {
      return '图片压缩请求超时，请重试';
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      return '无法连接到 Tinify API 服务器';
    } else {
      return `图片压缩失败：${error.message || '未知错误'}`;
    }
  }
}