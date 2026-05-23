/**
 * AES-256-GCM 加密器（Property 15 / R20.4）
 *
 * - 32 字节密钥（来自 process.env.AES_KEY hex）
 * - 12 字节随机 IV
 * - GCM 自带 16 字节 auth tag
 * - 密文存储格式：`iv_hex:tag_hex:ciphertext_hex`
 * - 启动期校验：缺失或长度错误立即抛错
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';

const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const TAG_LENGTH_BYTES = 16;

export class Aes256Encryptor {
  private readonly key: Buffer;

  constructor(hexKey: string) {
    if (!hexKey) {
      throw new Error('AES_KEY 缺失：请在环境变量中设置 32 字节 hex（64 字符）的 AES_KEY');
    }
    if (!/^[0-9a-fA-F]+$/.test(hexKey)) {
      throw new Error('AES_KEY 必须是 hex 字符串');
    }
    if (hexKey.length !== KEY_LENGTH_BYTES * 2) {
      throw new Error(`AES_KEY 长度错误：期望 ${KEY_LENGTH_BYTES * 2} hex 字符，实际 ${hexKey.length}`);
    }
    this.key = Buffer.from(hexKey, 'hex');
  }

  /**
   * 加密明文，返回 `iv_hex:tag_hex:ciphertext_hex`
   */
  encrypt(plain: string): string {
    if (typeof plain !== 'string' || plain.length === 0) {
      throw new Error('encrypt: 明文不能为空');
    }
    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
  }

  /**
   * 解密；密文格式不合法 / tag 校验失败时抛错
   */
  decrypt(packed: string): string {
    if (typeof packed !== 'string') {
      throw new Error('decrypt: 密文必须是字符串');
    }
    const parts = packed.split(':');
    if (parts.length !== 3) {
      throw new Error('decrypt: 密文格式错误（期望 iv:tag:ciphertext）');
    }
    const [ivHex, tagHex, ctHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const ct = Buffer.from(ctHex, 'hex');
    if (iv.length !== IV_LENGTH_BYTES) throw new Error('decrypt: IV 长度错误');
    if (tag.length !== TAG_LENGTH_BYTES) throw new Error('decrypt: tag 长度错误');
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(ct), decipher.final()]);
    return out.toString('utf8');
  }
}

/**
 * Nest provider factory：从 env 读取并构造单例；启动期校验 AES_KEY
 */
export function createAesEncryptorFromEnv(): Aes256Encryptor {
  return new Aes256Encryptor(process.env.AES_KEY || '');
}

@Injectable()
export class AesEncryptorService {
  // 仅作为 DI 容器入口；构造时会校验 env，启动失败暴露问题
  readonly enc: Aes256Encryptor = createAesEncryptorFromEnv();

  encrypt(plain: string): string { return this.enc.encrypt(plain); }
  decrypt(packed: string): string { return this.enc.decrypt(packed); }
}
