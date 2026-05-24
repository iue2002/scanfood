/**
 * 把后端返回的图片 URL 解析为浏览器可加载的最终地址
 *
 * 关键：避免 Mixed Content
 *   - admin-web 在 dev 跑 https（mkcert）时，如果硬拼 http://localhost:3000，
 *     浏览器会拒绝加载（Mixed Content）
 *   - 解决：dev 走相对路径 /uploads/...，由 vite proxy 代理到后端 3000
 *           prod 走 VITE_API_BASE_URL 配置的同协议地址
 *
 * 输入示例：
 *   - "/uploads/xxx.jpg"            → 同协议相对路径
 *   - "http://example.com/img.jpg"  → 外部完整 URL（透传）
 *   - "uploads/xxx.jpg"             → 自动加 /
 *   - "" / null / undefined         → 返回 ""
 */
export function resolveImageUrl(raw: string | null | undefined): string {
  if (!raw) return ''
  // 已是完整 URL（http / https）
  if (/^https?:\/\//i.test(raw)) {
    // dev 环境如果是 http://localhost:3000/uploads/... 这种和当前 https 冲突
    // 转为相对路径让 vite proxy 处理
    if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
      try {
        const u = new URL(raw)
        if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) {
          return u.pathname + u.search
        }
      } catch { /* malformed url, return as-is */ }
    }
    return raw
  }
  // 相对路径：补 / 前缀
  return raw.startsWith('/') ? raw : '/' + raw
}
