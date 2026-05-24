import { Injectable } from '@nestjs/common';
import { db } from '@/storage/database/mysql-client';
import { store_settings } from '@/storage/database/shared/schema';
import { eq } from 'drizzle-orm';
import { LocalImageCleanupService } from '@/modules/merchant-ops/common/image-cleanup';

@Injectable()
export class StoreSettingsService {
  constructor(private readonly imageCleanup: LocalImageCleanupService) {}

  async getStoreSettings() {
    const settings = await db
      .select()
      .from(store_settings)
      .limit(1);
    
    if (settings.length === 0) {
      return { store_name: '伊美轩', store_avatar: '' };
    }
    
    return settings[0];
  }

  async updateStoreSettings(data: { store_name: string; store_avatar?: string }) {
    const existing = await db
      .select()
      .from(store_settings)
      .limit(1);
    
    if (existing.length === 0) {
      await db
        .insert(store_settings)
        .values({
          store_name: data.store_name,
          store_avatar: data.store_avatar || null,
        });
      
      return { store_name: data.store_name, store_avatar: data.store_avatar || '' };
    }
    
    const oldAvatar = existing[0].store_avatar ?? null;
    const nextAvatar = data.store_avatar !== undefined ? data.store_avatar : oldAvatar;

    await db
      .update(store_settings)
      .set({
        store_name: data.store_name,
        store_avatar: nextAvatar,
      })
      .where(eq(store_settings.id, existing[0].id));

    // 头像被替换：清理旧的本地文件
    if (oldAvatar && data.store_avatar && oldAvatar !== data.store_avatar) {
      void this.imageCleanup.removeByUrl(oldAvatar);
    }
    
    return { 
      store_name: data.store_name, 
      store_avatar: nextAvatar
    };
  }
}
