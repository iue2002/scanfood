import { Controller, Get, Put, Body } from '@nestjs/common';
import { StoreSettingsService } from './store-settings.service';

@Controller('store-settings')
export class StoreSettingsController {
  constructor(private readonly storeSettingsService: StoreSettingsService) {}

  @Get()
  async getSettings() {
    const settings = await this.storeSettingsService.getStoreSettings();
    return { success: true, data: settings };
  }

  @Put()
  async updateSettings(@Body() body: { store_name: string; store_avatar?: string }) {
    const settings = await this.storeSettingsService.updateStoreSettings(body);
    return { success: true, data: settings };
  }
}