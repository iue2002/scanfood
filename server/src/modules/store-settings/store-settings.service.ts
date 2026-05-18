import { Injectable } from '@nestjs/common';
import { db } from '@/storage/database/mysql-client';
import { store_settings } from '@/storage/database/shared/schema';
import { eq } from 'drizzle-orm';

@Injectable()
export class StoreSettingsService {
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
    
    await db
      .update(store_settings)
      .set({
        store_name: data.store_name,
        store_avatar: data.store_avatar || existing[0].store_avatar,
      })
      .where(eq(store_settings.id, existing[0].id));
    
    return { 
      store_name: data.store_name, 
      store_avatar: data.store_avatar || existing[0].store_avatar 
    };
  }
}
