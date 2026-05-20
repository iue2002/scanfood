import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { StoreSettingsService } from './store-settings.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UpdateStoreSettingsDto } from './dto/store-settings.dto';

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
}