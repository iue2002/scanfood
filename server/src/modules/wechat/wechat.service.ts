import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class WechatService {
  private readonly logger = new Logger(WechatService.name);
  
  private accessToken: string = '';
  private accessTokenExpiresAt: number = 0;
  
  // 微信API基础URL
  private readonly baseUrl = 'https://api.weixin.qq.com/cgi-bin';
  // 微信小程序码API基础URL
  private readonly wxacodeBaseUrl = 'https://api.weixin.qq.com';
  
  // 配置项
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly uploadPath: string;
  
  constructor(private readonly configService: ConfigService) {
    this.appId = this.configService.get<string>('WX_APP_ID', '');
    this.appSecret = this.configService.get<string>('WX_APP_SECRET', '');
    this.uploadPath = this.configService.get<string>('UPLOAD_PATH', './uploads');
  }

  /**
   * 获取微信小程序access_token
   */
  async getAccessToken(): Promise<string> {
    const now = Date.now();
    
    // 如果access_token还没过期，直接返回
    if (this.accessToken && now < this.accessTokenExpiresAt) {
      return this.accessToken;
    }

    try {
      const url = `${this.baseUrl}/token?grant_type=client_credential&appid=${this.appId}&secret=${this.appSecret}`;
      const response = await this.request(url);
      
      if (response.access_token) {
        this.accessToken = response.access_token;
        // 设置过期时间（微信返回的expires_in是7200秒，提前200秒刷新）
        this.accessTokenExpiresAt = now + (response.expires_in - 200) * 1000;
        this.logger.log('获取access_token成功');
        return this.accessToken;
      } else {
        throw new Error(`获取access_token失败: ${response.errmsg || '未知错误'}`);
      }
    } catch (error) {
      this.logger.error('获取access_token失败:', error);
      throw error;
    }
  }

  /**
   * 生成小程序码（使用getwxacodeunlimit接口，无数量限制）
   * @param scene 场景值，用于传递桌台ID等参数
   * @param page 小程序页面路径（如：pages/order/order）
   * @param width 二维码宽度，默认430
   */
  async generateQrCode(scene: string, page: string = 'pages/order/order', width: number = 430): Promise<string> {
    try {
      const accessToken = await this.getAccessToken();
      const url = `${this.wxacodeBaseUrl}/wxa/getwxacodeunlimit?access_token=${accessToken}`;
      
      const postData = JSON.stringify({
        scene: scene,
        page: page,
        width: width
      });

      this.logger.log(`调用微信API生成二维码（getwxacodeunlimit）`);
      this.logger.log(`请求参数: scene=${scene}, page=${page}, width=${width}`);

      // 发送POST请求获取二进制图片数据
      const imageBuffer = await this.requestBinary(url, postData);
      
      // 生成文件名
      const fileName = `qrcode_${scene}_${Date.now()}.png`;
      const filePath = path.join(this.uploadPath, fileName);
      
      // 确保目录存在
      if (!fs.existsSync(this.uploadPath)) {
        fs.mkdirSync(this.uploadPath, { recursive: true });
      }
      
      // 保存图片文件
      fs.writeFileSync(filePath, imageBuffer);
      
      // 返回可访问的URL路径
      const qrCodeUrl = `/uploads/${fileName}`;
      this.logger.log(`生成二维码成功: ${qrCodeUrl}`);
      
      return qrCodeUrl;
    } catch (error) {
      this.logger.error('生成二维码失败:', error);
      throw error;
    }
  }

  /**
   * 生成小程序码（使用createwxaqrcode接口，有限制：10000个）
   * 这个接口在小程序未发布时可能可用
   * @param scene 场景值
   * @param page 页面路径
   * @param width 宽度
   */
  async createQRCode(scene: string, page: string = 'pages/order/order', width: number = 430): Promise<string> {
    try {
      const accessToken = await this.getAccessToken();
      // 使用小程序码专用接口
      const url = `${this.wxacodeBaseUrl}/cgi-bin/wxaapp/createwxaqrcode?access_token=${accessToken}`;
      
      const postData = JSON.stringify({
        path: `${page}?scene=${scene}`,
        width: width
      });

      this.logger.log(`调用微信API createQRCode（createwxaqrcode）`);
      this.logger.log(`请求参数: path=${page}?scene=${scene}, width=${width}`);

      const imageBuffer = await this.requestBinary(url, postData);
      
      // createQRCode 返回的是 JPEG 格式
      const fileName = `qrcode_${scene}_${Date.now()}.jpg`;
      const filePath = path.join(this.uploadPath, fileName);
      
      if (!fs.existsSync(this.uploadPath)) {
        fs.mkdirSync(this.uploadPath, { recursive: true });
      }
      
      fs.writeFileSync(filePath, imageBuffer);
      
      const qrCodeUrl = `/uploads/${fileName}`;
      this.logger.log(`生成小程序码(createQRCode)成功: ${qrCodeUrl}`);
      
      return qrCodeUrl;
    } catch (error) {
      this.logger.error('生成小程序码(createQRCode)失败:', error);
      throw error;
    }
  }

  /**
   * 发送HTTP GET请求
   */
  private request(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        });
      }).on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * 发送HTTP POST请求获取二进制数据
   */
  private requestBinary(url: string, postData: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const options = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = https.request(url, options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => {
          chunks.push(chunk);
        });
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          
          // 检查响应状态码
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP错误 ${res.statusCode}: ${res.statusMessage}`));
            return;
          }
          
          // 检查内容长度
          if (buffer.length === 0) {
            reject(new Error('微信API返回空数据'));
            return;
          }
          
          // 检查是否是JSON错误响应（微信API出错时会返回JSON）
          const contentType = res.headers['content-type'];
          if (contentType && contentType.includes('application/json')) {
            try {
              const errorData = JSON.parse(buffer.toString());
              if (errorData.errcode) {
                reject(new Error(`微信API错误 ${errorData.errcode}: ${errorData.errmsg}`));
                return;
              }
            } catch {
              // 不是有效的JSON，直接返回buffer
            }
          }
          
          // 检查是否是图片（支持PNG和JPEG格式）
          // PNG的magic bytes是89 50 4E 47
          // JPEG的magic bytes是FF D8 FF
          const isPng = buffer.length >= 4 && 
            buffer[0] === 0x89 && buffer[1] === 0x50 && 
            buffer[2] === 0x4E && buffer[3] === 0x47;
          
          const isJpeg = buffer.length >= 3 && 
            buffer[0] === 0xFF && buffer[1] === 0xD8 && 
            buffer[2] === 0xFF;
          
          if (!isPng && !isJpeg) {
            // 尝试解析为JSON错误信息
            try {
              const errorData = JSON.parse(buffer.toString('utf-8'));
              if (errorData.errcode) {
                reject(new Error(`微信API错误 ${errorData.errcode}: ${errorData.errmsg}`));
                return;
              }
            } catch {
              // 不是JSON
            }
            
            this.logger.error(`微信API返回的不是有效图片，内容长度: ${buffer.length} bytes`);
            this.logger.error(`响应内容(前200字符): ${buffer.toString('utf-8').substring(0, 200)}`);
            reject(new Error(`微信API返回的不是有效图片`));
            return;
          }
          
          resolve(buffer);
        });
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * 获取小程序URL Scheme（用于生成二维码，可在未发布时使用）
   * @param page 页面路径
   * @param query 查询参数
   */
  async getUrlScheme(page: string = 'pages/order/order', query: string = ''): Promise<string> {
    try {
      const accessToken = await this.getAccessToken();
      const url = `${this.baseUrl}/wxopen/generatescheme?access_token=${accessToken}`;
      
      const postData = JSON.stringify({
        jump_wxa: {
          path: page,
          query: query
        },
        is_expire: false
      });

      const response = await this.requestWithPost(url, postData);
      
      if (response.openlink) {
        this.logger.log(`生成URL Scheme成功: ${response.openlink.substring(0, 50)}...`);
        return response.openlink;
      } else {
        throw new Error(`生成URL Scheme失败: ${response.errmsg || '未知错误'}`);
      }
    } catch (error) {
      this.logger.error('获取URL Scheme失败:', error);
      throw error;
    }
  }

  /**
   * 发送HTTP POST请求获取JSON响应
   */
  private requestWithPost(url: string, postData: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const options = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = https.request(url, options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (result.errcode && result.errcode !== 0) {
              reject(new Error(`微信API错误 ${result.errcode}: ${result.errmsg}`));
            } else {
              resolve(result);
            }
          } catch {
            resolve(data);
          }
        });
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * 刷新access_token
   */
  refreshAccessToken(): void {
    this.accessToken = '';
    this.accessTokenExpiresAt = 0;
  }
}
