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
import { PermissionsGuard } from '../merchant-ops/auth/permissions.guard';
import { Permissions } from '../merchant-ops/auth/decorators';
import { UpdateStoreSettingsDto } from './dto/store-settings.dto';
import { UpdateSmtpDto } from './dto/smtp.dto';

@Controller('store-settings')
export class StoreSettingsController {
  constructor(private readonly storeSettingsService: StoreSettingsService) {}

  @Get()
  async getSettings() {
    const settings = await this.storeSettingsService.getStoreSettings();
    return { success: true, data: settings };
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('STORE_SETTINGS_UPDATE')
  @Put()
  async updateSettings(@Body() dto: UpdateStoreSettingsDto) {
    const settings = await this.storeSettingsService.updateStoreSettings(dto);
    return { success: true, data: settings };
  }

  // ============================================================
  // SMTP 配置（owner / manager / admin）
  // ============================================================

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('STORE_SMTP_UPDATE')
  @Get('smtp')
  async getSmtp() {
    const data = await this.storeSettingsService.getSmtpConfig();
    return { success: true, data };
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('STORE_SMTP_UPDATE')
  @Put('smtp')
  async updateSmtp(@Body() dto: UpdateSmtpDto) {
    const data = await this.storeSettingsService.updateSmtpConfig(dto);
    return { success: true, data };
  }
}
