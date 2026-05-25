import {
  Controller,
  Get,
  Put,
  Body,
  UseGuards,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { StoreSettingsService } from './store-settings.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UpdateStoreSettingsDto } from './dto/store-settings.dto';
import { UpdateSmtpDto } from './dto/smtp.dto';

const OWNER_ROLES = new Set(['owner', 'manager', 'admin']);

@Controller('store-settings')
export class StoreSettingsController {
  constructor(private readonly storeSettingsService: StoreSettingsService) {}

  @Get()
  async getSettings() {
    const settings = await this.storeSettingsService.getStoreSettings();
    return { success: true, data: settings };
  }

  @UseGuards(JwtAuthGuard)
  @Put()
  async updateSettings(@Body() dto: UpdateStoreSettingsDto) {
    const settings = await this.storeSettingsService.updateStoreSettings(dto);
    return { success: true, data: settings };
  }

  // ============================================================
  // SMTP 配置（owner / manager / admin 才能读写，避免普通员工窥探）
  // ============================================================

  @UseGuards(JwtAuthGuard)
  @Get('smtp')
  async getSmtp(@Req() req: any) {
    if (!OWNER_ROLES.has(req?.user?.role)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', msg: '仅店主/经理可查看 SMTP 配置' });
    }
    const data = await this.storeSettingsService.getSmtpConfig();
    return { success: true, data };
  }

  @UseGuards(JwtAuthGuard)
  @Put('smtp')
  async updateSmtp(@Body() dto: UpdateSmtpDto, @Req() req: any) {
    if (!OWNER_ROLES.has(req?.user?.role)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', msg: '仅店主/经理可修改 SMTP 配置' });
    }
    const data = await this.storeSettingsService.updateSmtpConfig(dto);
    return { success: true, data };
  }
}
