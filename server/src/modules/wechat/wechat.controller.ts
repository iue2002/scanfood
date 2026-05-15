import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { WechatService } from './wechat.service';
import { JwtAuthGuard } from '@/modules/auth/jwt-auth.guard';

@Controller('wechat')
@UseGuards(JwtAuthGuard)
export class WechatController {
  constructor(private readonly wechatService: WechatService) {}

  /**
   * 获取access_token（测试用）
   */
  @Get('access-token')
  async getAccessToken() {
    const token = await this.wechatService.getAccessToken();
    return { access_token: token };
  }

  /**
   * 生成小程序码
   * @param scene 场景值，用于传递桌台ID等参数
   * @param page 小程序页面路径
   * @param width 二维码宽度
   */
  @Post('qrcode')
  async generateQrCode(
    @Query('scene') scene: string,
    @Query('page') page: string = 'pages/order/order',
    @Query('width') width: number = 430
  ) {
    const qrCodeUrl = await this.wechatService.generateQrCode(scene, page, width);
    return { qr_code_url: qrCodeUrl };
  }

  /**
   * 使用createQRCode接口生成小程序码
   */
  @Post('qrcode-v1')
  async createQRCode(
    @Query('scene') scene: string,
    @Query('page') page: string = 'pages/order/order',
    @Query('width') width: number = 430
  ) {
    const qrCodeUrl = await this.wechatService.createQRCode(scene, page, width);
    return { qr_code_url: qrCodeUrl };
  }

  /**
   * 刷新access_token
   */
  @Post('refresh-token')
  async refreshToken() {
    this.wechatService.refreshAccessToken();
    return { message: '已刷新access_token' };
  }
}
