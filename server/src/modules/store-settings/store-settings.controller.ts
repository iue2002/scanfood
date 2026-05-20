import { Controller, Get, Put, Body } from '@nestjs/common';
import { StoreSettingsService } from './store-settings.service';
import { UpdateStoreSettingsDto } from './dto/store-settings.dto';

@Controller('store-settings')
export class StoreSettingsController {
  constructor(private readonly storeSettingsService: StoreSettingsService) {}

  @Get()
  async getSettings() {
    const settings = await this.storeSettingsService.getStoreSettings();
    return { success: true, data: settings };
  }

  @Put()
  async updateSettings(@Body() dto: UpdateStoreSettingsDto) {
    const settings = await this.storeSettingsService.updateStoreSettings(dto);
    return { success: true, data: settings };
  }
}