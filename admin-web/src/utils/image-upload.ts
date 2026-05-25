/**
 * 智能图片上传 helper
 *
 * 流水线（双层叠加，极致压缩）：
 *   1. HEIC 检测 → heic2any 转 JPEG（兼容 iPhone 用户）
 *   2. 浏览器端用 browser-image-compression 预压（降上传带宽）
 *   3. 调 /upload/compress（服务端 sharp 二次处理 + 出主图/缩略图）
 *   4. 服务端失败时：caller 调 fallbackOriginalUpload 走 /upload/image
 *
 * 与旧 Tinify 流程的兼容：
 *   - /upload/compress 仍返回 { success, data: { url, originalSize, compressedSize, compressionRatio, ... } }
 *     新增字段 thumbnailUrl / mainWidth / mainHeight / format（可选消费）
 *   - 失败时返回 { success: false, message, allowOriginalUpload: true }
 */
import imageCompression from 'browser-image-compression'
import request from '@/api/request'

export interface UploadProgress {
  /** 当前阶段 */
  stage: 'heic' | 'compressing' | 'uploading' | 'done'
  /** 大致进度 0-100 */
  percent: number
}

export interface CompressionResult {
  success: boolean
  data?: {
    url: string
    /** 缩略图 URL（新增字段；旧代码不读不影响） */
    thumbnailUrl?: string
    originalSize: number
    compressedSize: number
    compressionRatio: number
    mainWidth?: number
    mainHeight?: number
    format?: string
  }
  message?: string
  allowOriginalUpload?: boolean
}

interface SmartUploadOptions {
  /** 进度回调 */
  onProgress?: (p: UploadProgress) => void
  /**
   * 浏览器预压目标体积（MB）。低估这个值不会降低画质——服务端 sharp 还会做最终标准化。
   * 默认 1MB（足够压完仍保留高分辨率给后端二次处理）
   */
  preCompressTargetMB?: number
  /** 浏览器预压最大边长（px）。默认 1920 */
  preCompressMaxDimension?: number
}

const HEIC_MIMES = ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']

function isHeic(file: File): boolean {
  if (HEIC_MIMES.includes(file.type.toLowerCase())) return true
  const name = file.name.toLowerCase()
  return name.endsWith('.heic') || name.endsWith('.heif')
}

/**
 * iPhone HEIC → JPEG 转换
 * heic2any 是动态加载，避免初始 bundle 增大（绝大多数用户都不需要）
 */
async function convertHeicIfNeeded(file: File, onProgress?: (p: UploadProgress) => void): Promise<File> {
  if (!isHeic(file)) return file
  onProgress?.({ stage: 'heic', percent: 5 })
  const heic2any = (await import('heic2any')).default
  const blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 })
  const out = Array.isArray(blob) ? blob[0] : blob
  const newName = file.name.replace(/\.(heic|heif)$/i, '.jpg')
  return new File([out], newName, { type: 'image/jpeg', lastModified: Date.now() })
}

/**
 * 浏览器端预压缩
 * 已经够小的图（< 200KB 且边长 ≤ maxDimension）直接透传，避免二次劣化
 */
async function preCompress(
  file: File,
  targetMB: number,
  maxDimension: number,
  onProgress?: (p: UploadProgress) => void,
): Promise<File> {
  // 小图直接透传：浏览器端不做任何处理（server 端会做最终标准化）
  if (file.size <= 200 * 1024) {
    onProgress?.({ stage: 'compressing', percent: 30 })
    return file
  }

  onProgress?.({ stage: 'compressing', percent: 10 })

  try {
    const compressed = await imageCompression(file, {
      maxSizeMB: targetMB,
      maxWidthOrHeight: maxDimension,
      useWebWorker: true,
      // 浏览器输出 JPEG 兼容性最好；后端会再转 WebP
      fileType: 'image/jpeg',
      // 进度回调（0-100）
      onProgress: (p: number) => {
        // 把 0-100 映射到 10-30 进度区间
        onProgress?.({ stage: 'compressing', percent: 10 + Math.round(p * 0.2) })
      },
    } as any)
    return compressed instanceof File
      ? compressed
      : new File([compressed], file.name, { type: 'image/jpeg' })
  } catch (err) {
    // 浏览器压缩失败（极少见）→ 透传原图，让服务端兜底
    console.warn('[image-upload] 浏览器预压失败，透传原图:', err)
    return file
  }
}

/**
 * 智能上传：HEIC 转换 → 浏览器预压 → 调 /upload/compress
 * 失败时返回 { success: false, allowOriginalUpload: true }，caller 决定是否走 fallback
 */
export async function smartUpload(
  file: File,
  options: SmartUploadOptions = {},
): Promise<CompressionResult> {
  const { onProgress, preCompressTargetMB = 1, preCompressMaxDimension = 1920 } = options

  try {
    // 1. HEIC 转 JPEG
    let working = await convertHeicIfNeeded(file, onProgress)

    // 2. 浏览器预压
    working = await preCompress(working, preCompressTargetMB, preCompressMaxDimension, onProgress)

    // 3. 上传到服务端 /upload/compress
    onProgress?.({ stage: 'uploading', percent: 60 })
    const formData = new FormData()
    formData.append('file', working)

    const res: CompressionResult = await request.post('/upload/compress', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60_000,
    })

    onProgress?.({ stage: 'done', percent: 100 })
    return res
  } catch (err: any) {
    return {
      success: false,
      message: err?.message || '图片处理失败',
      allowOriginalUpload: true,
    }
  }
}

/**
 * 原图直传（fallback 路径）
 * 注意：这里也走 HEIC 转换 + 浏览器预压，避免给后端传几 MB 的 HEIC
 */
export async function fallbackOriginalUpload(
  file: File,
  options: SmartUploadOptions = {},
): Promise<{ url: string; size: number; name: string }> {
  const { onProgress, preCompressTargetMB = 1, preCompressMaxDimension = 1920 } = options

  // HEIC 转 JPEG（必须，后端 multer 也接受 HEIC，但浏览器测预览会有问题）
  let working = await convertHeicIfNeeded(file, onProgress)
  // 浏览器预压（即便走原图也压一下，节省带宽）
  working = await preCompress(working, preCompressTargetMB, preCompressMaxDimension, onProgress)

  onProgress?.({ stage: 'uploading', percent: 60 })
  const formData = new FormData()
  formData.append('file', working)

  const res: any = await request.post('/upload/image', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60_000,
  })

  onProgress?.({ stage: 'done', percent: 100 })
  return res
}
