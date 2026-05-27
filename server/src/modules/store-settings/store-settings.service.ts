import { Injectable } from '@nestjs/common';
import { db } from '@/storage/database/mysql-client';
import { store_settings } from '@/storage/database/shared/schema';
import { eq } from 'drizzle-orm';
import { LocalImageCleanupService } from '@/modules/merchant-ops/common/image-cleanup';
import { AesEncryptorService } from '@/modules/merchant-ops/print/aes-encryptor';

export interface SmtpConfigPublic {
  mode: 'platform' | 'custom';
  host?: string | null;
  port?: number | null;
  user?: string | null;
  /** 是否已设置密码（不返回明文密码或密文） */
  has_password: boolean;
  from?: string | null;
  secure: boolean;
}

@Injectable()
export class StoreSettingsService {
  constructor(
    private readonly imageCleanup: LocalImageCleanupService,
    private readonly aes: AesEncryptorService,
  ) {}

  async getStoreSettings() {
    // 仅返回小程序/公开页面用得到的字段。
    // SMTP 配置（含 host/user/from 等敏感信息）必须走 getSmtpConfig（auth guarded）。
    const settings = await db
      .select({
        id: store_settings.id,
        store_name: store_settings.store_name,
        store_avatar: store_settings.store_avatar,
        pickup_reset_time: store_settings.pickup_reset_time,
      })
      .from(store_settings)
      .limit(1);

    if (settings.length === 0) {
      return { store_name: '我的小店', store_avatar: '', pickup_reset_time: '00:00' };
    }
    return settings[0];
  }

  async updateStoreSettings(data: { store_name: string; store_avatar?: string; pickup_reset_time?: string }) {
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
          pickup_reset_time: data.pickup_reset_time || '00:00',
        });
      
      return { store_name: data.store_name, store_avatar: data.store_avatar || '', pickup_reset_time: data.pickup_reset_time || '00:00' };
    }
    
    const oldAvatar = existing[0].store_avatar ?? null;
    const nextAvatar = data.store_avatar !== undefined ? data.store_avatar : oldAvatar;
    const nextReset = data.pickup_reset_time !== undefined ? data.pickup_reset_time : existing[0].pickup_reset_time || '00:00';

    await db
      .update(store_settings)
      .set({
        store_name: data.store_name,
        store_avatar: nextAvatar,
        pickup_reset_time: nextReset,
      })
      .where(eq(store_settings.id, existing[0].id));

    // 头像被替换：清理旧的本地文件
    if (oldAvatar && data.store_avatar && oldAvatar !== data.store_avatar) {
      void this.imageCleanup.removeByUrl(oldAvatar);
    }
    
    return { 
      store_name: data.store_name, 
      store_avatar: nextAvatar,
      pickup_reset_time: nextReset
    };
  }

  // ============================================================
  // SMTP 配置（多通道通知 - 邮件兜底）
  // ============================================================

  /**
   * 读取 SMTP 配置（不返回密码本体；用 has_password 标记是否已设置）
   */
  async getSmtpConfig(): Promise<SmtpConfigPublic> {
    const rows = await db.select().from(store_settings).limit(1);
    if (rows.length === 0) {
      return {
        mode: 'platform',
        has_password: false,
        secure: true,
      };
    }
    const r = rows[0] as any;
    return {
      mode: (r.smtp_mode as 'platform' | 'custom') || 'platform',
      host: r.smtp_host ?? null,
      port: r.smtp_port ?? null,
      user: r.smtp_user ?? null,
      has_password: !!r.smtp_pass_enc,
      from: r.smtp_from ?? null,
      secure: r.smtp_secure === undefined || r.smtp_secure === null ? true : !!r.smtp_secure,
    };
  }

  /**
   * 写入 SMTP 配置（密码经 AES-256-GCM 加密存储）
   *
   * 行为：
   *  - 不存在 settings 行：先 INSERT 一条默认 store_name 记录
   *  - mode='platform'：清空 smtp_host/port/user/from（保留 smtp_pass_enc 不动）
   *    - 这样切回 custom 不需要重填密码（可选行为）
   *  - mode='custom' + pass 字段：加密后写入 smtp_pass_enc
   *  - mode='custom' + 不填 pass：保留旧 smtp_pass_enc（用户只是改了 host）
   */
  async updateSmtpConfig(dto: {
    mode: 'platform' | 'custom';
    host?: string;
    port?: number;
    user?: string;
    pass?: string;
    from?: string;
    secure?: boolean;
  }): Promise<SmtpConfigPublic> {
    const existing = await db.select().from(store_settings).limit(1);

    // 编码新的 SMTP 字段
    const baseUpdate: Record<string, any> = {
      smtp_mode: dto.mode,
    };
    if (dto.mode === 'custom') {
      baseUpdate.smtp_host = dto.host ?? null;
      baseUpdate.smtp_port = dto.port ?? null;
      baseUpdate.smtp_user = dto.user ?? null;
      baseUpdate.smtp_from = dto.from ?? null;
      if (dto.secure !== undefined) baseUpdate.smtp_secure = dto.secure;
      if (dto.pass && dto.pass.length > 0) {
        baseUpdate.smtp_pass_enc = this.aes.encrypt(dto.pass);
      }
    }
    // mode='platform' 时只切换 mode，不动 custom 字段（用户重新切回 custom 时不必重填）

    if (existing.length === 0) {
      await db.insert(store_settings).values({
        store_name: '我的小店',
        ...baseUpdate,
      } as any);
    } else {
      await db
        .update(store_settings)
        .set(baseUpdate)
        .where(eq(store_settings.id, existing[0].id));
    }

    return this.getSmtpConfig();
  }
}
