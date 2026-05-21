import { Injectable } from '@nestjs/common';
import * as svgCaptcha from 'svg-captcha';
import { randomUUID } from 'crypto';

/**
 * SVG 图形验证码服务
 * 业界主流方案：4 位数字字母混合 + 干扰线 + 噪点；服务端用内存 Map 存 token，5 分钟过期
 */

const TTL_MS = 5 * 60 * 1000;

interface CaptchaEntry {
  text: string;
  expiresAt: number;
}

@Injectable()
export class CaptchaService {
  private readonly store = new Map<string, CaptchaEntry>();

  constructor() {
    // 定时清理过期 token，避免内存泄漏
    setInterval(() => this.cleanup(), 60 * 1000).unref?.();
  }

  /**
   * 生成验证码图片 + token
   * @returns { token, svg } token 客户端拿来在 verify 时回传，svg 直接渲染
   */
  generate(): { token: string; svg: string } {
    const captcha = svgCaptcha.create({
      size: 4,
      ignoreChars: '0o1ilI', // 排除易混字符
      noise: 3,
      color: true,
      background: '#F8FAFC',
      width: 140,
      height: 48,
      fontSize: 48,
    });
    const token = randomUUID();
    this.store.set(token, {
      text: captcha.text.toLowerCase(),
      expiresAt: Date.now() + TTL_MS,
    });
    return { token, svg: captcha.data };
  }

  /**
   * 校验验证码（一次性，校验后立即销毁）
   * @returns true 校验通过；false 失败
   */
  verify(token: string, input: string): boolean {
    if (!token || !input) return false;
    const entry = this.store.get(token);
    if (!entry) return false;
    // 一次性，立即删除（无论结果）
    this.store.delete(token);
    if (Date.now() > entry.expiresAt) return false;
    return entry.text === input.toLowerCase();
  }

  private cleanup() {
    const now = Date.now();
    for (const [k, v] of this.store) {
      if (now > v.expiresAt) this.store.delete(k);
    }
  }
}
