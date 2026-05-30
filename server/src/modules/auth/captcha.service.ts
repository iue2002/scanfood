import { Injectable, Inject } from '@nestjs/common';
import * as svgCaptcha from 'svg-captcha';
import { randomUUID } from 'crypto';
import { TTL_STORE_TOKEN } from '@/modules/common/adapters/mysql-ttl-store.adapter';
import type { TtlStorePort } from '@/modules/common/ports/ttl-store.port';

const TTL_MS = 5 * 60 * 1000; // 5 分钟

@Injectable()
export class CaptchaService {
  constructor(
    @Inject(TTL_STORE_TOKEN)
    private readonly store: TtlStorePort,
  ) {}

  async generate(): Promise<{ token: string; svg: string }> {
    const captcha = svgCaptcha.create({
      size: 4,
      ignoreChars: '0o1ilI',
      noise: 3,
      color: true,
      background: '#F8FAFC',
      width: 140,
      height: 48,
      fontSize: 48,
    });
    const token = randomUUID();
    await this.store.set(`captcha:${token}`, { text: captcha.text.toLowerCase() }, TTL_MS);
    return { token, svg: captcha.data };
  }

  async verify(token: string, input: string): Promise<boolean> {
    if (!token || !input) return false;
    const entry = await this.store.get<{ text: string }>(`captcha:${token}`);
    if (!entry) return false;
    // 一次性，立即删除
    await this.store.delete(`captcha:${token}`);
    return entry.text === input.toLowerCase();
  }
}
