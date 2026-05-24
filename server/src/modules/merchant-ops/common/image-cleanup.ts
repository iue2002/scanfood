/**
 * 图片资源清理工具（纯函数 + IO 两层）
 *
 * 设计原则：
 *  1. 只清理"确认属于本项目本地上传"的文件（路径以 /uploads/ 开头）
 *  2. 外部 URL（http://、https://、oss://、tos:// 等）一律保留，避免误删第三方资源
 *  3. 任何失败都不阻塞业务主流程（删菜品/桌台失败比清孤儿图片重要）
 *  4. 跨平台路径处理：URL 用 / 分隔，文件系统用 path.join
 *
 * Property 24（资源清理路径白名单）：
 *  - 接受当且仅当 url 以 '/uploads/' 起头且不含路径穿越（'..' / 绝对路径）
 *  - 拒绝绝对外部 URL（http://, https://）
 *  - 拒绝 null / undefined / 空串（视为 no-op）
 */
import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';

const UPLOAD_PREFIX = '/uploads/';

export interface ResolvedLocalUpload {
  /** 经过校验后的相对 url（含 /uploads/ 前缀） */
  url: string;
  /** 解析后的安全绝对路径（uploadsRoot 下） */
  absPath: string;
}

/**
 * 把 url 投影成本地清理路径；不合法/非本地上传时返回 null
 *
 * 关键不变量（PBT）：
 *  - 返回值非空时 absPath 一定在 uploadsRoot 下（防路径穿越）
 *  - 返回值非空时 url 一定以 '/uploads/' 起头
 */
export function resolveLocalUpload(rawUrl: string | null | undefined, uploadsRoot: string): ResolvedLocalUpload | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0) return null;
  // 拒绝带 schema 的外部 URL
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;
  // 必须以 /uploads/ 起头
  if (!trimmed.startsWith(UPLOAD_PREFIX)) return null;
  // 提取相对路径片段
  const rel = trimmed.slice(UPLOAD_PREFIX.length);
  if (rel.length === 0) return null;
  // 拒绝路径穿越
  if (rel.includes('..') || rel.includes('\\..\\') || rel.startsWith('/')) return null;
  // 拒绝 fragment / query
  if (rel.includes('?') || rel.includes('#')) return null;
  // 拒绝空白字符
  if (/[\s\0]/.test(rel)) return null;

  const absPath = path.resolve(uploadsRoot, rel);
  // 二次校验：解析后的绝对路径必须在 uploadsRoot 下
  const rootAbs = path.resolve(uploadsRoot);
  const sep = path.sep;
  if (!absPath.startsWith(rootAbs + sep) && absPath !== rootAbs) {
    return null;
  }
  // 显式拒绝 absPath 等于 root（不能删 uploads 目录本身）
  if (absPath === rootAbs) return null;

  return { url: trimmed, absPath };
}

@Injectable()
export class LocalImageCleanupService {
  private readonly logger = new Logger(LocalImageCleanupService.name);
  private readonly uploadsRoot: string = path.join(process.cwd(), 'uploads');

  /**
   * 删一个 url 对应的本地文件；外部/非法 url 静默跳过
   * 永远不抛错（业务侧只需 fire-and-forget）
   */
  async removeByUrl(rawUrl: string | null | undefined): Promise<{ removed: boolean; reason?: string }> {
    const resolved = resolveLocalUpload(rawUrl, this.uploadsRoot);
    if (!resolved) {
      return { removed: false, reason: 'not-local-upload' };
    }
    try {
      await fs.unlink(resolved.absPath);
      this.logger.log(`[image-cleanup] removed ${resolved.url}`);
      return { removed: true };
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        return { removed: false, reason: 'not-found' };
      }
      this.logger.warn(`[image-cleanup] failed to remove ${resolved.url}: ${err?.message ?? err}`);
      return { removed: false, reason: err?.message || 'unknown' };
    }
  }

  /**
   * 批量清理（如菜品多张图、桌台二维码等批量场景）
   * 每个 url 失败都被吞，不影响其它清理
   */
  async removeAll(urls: Array<string | null | undefined>): Promise<{ removed: number; skipped: number }> {
    let removed = 0;
    let skipped = 0;
    for (const u of urls) {
      const r = await this.removeByUrl(u);
      if (r.removed) removed += 1;
      else skipped += 1;
    }
    return { removed, skipped };
  }
}
