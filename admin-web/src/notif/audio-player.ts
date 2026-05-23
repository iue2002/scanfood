/**
 * 通知声音播放器
 *
 * - 加载或播放失败 5 秒未成功视为失败 → 降级到默认音色
 * - 试听场景：超时 / 解码失败时 onFailure 回调，由 UI 提示"音色加载失败，已降级"（R10.6）
 * - 正式通知场景：失败仍然不抑制 toast/desktop（Property 12），仅放弃声音
 *
 * 调用方负责传入正确的 catalog（含默认 fallback url）。
 */
const AUDIO_TIMEOUT_MS = 5000
const PREVIEW_MAX_MS = 3000

let lastFailedUrl: string | null = null

function loadAndPlay(url: string, maxMs: number): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    if (typeof Audio === 'undefined') {
      resolve({ ok: false, error: 'Audio API 不可用' })
      return
    }
    let resolved = false
    const audio = new Audio(url)
    audio.preload = 'auto'

    const finish = (ok: boolean, error?: string) => {
      if (resolved) return
      resolved = true
      try { audio.pause() } catch { /* ignore */ }
      resolve({ ok, error })
    }

    const timeoutId = setTimeout(() => {
      finish(false, '加载超时')
    }, AUDIO_TIMEOUT_MS)

    // 试听场景：超过 maxMs 主动停止，但视为成功
    const previewStopId = setTimeout(() => {
      if (!resolved) finish(true)
    }, maxMs)

    audio.oncanplaythrough = async () => {
      clearTimeout(timeoutId)
      try {
        const playPromise = audio.play()
        if (playPromise && typeof playPromise.then === 'function') {
          await playPromise
        }
      } catch (err: any) {
        finish(false, err?.message || '播放被浏览器拦截')
        clearTimeout(previewStopId)
      }
    }
    audio.onerror = () => {
      clearTimeout(timeoutId)
      clearTimeout(previewStopId)
      finish(false, '加载/解码失败')
    }
    audio.onended = () => {
      clearTimeout(timeoutId)
      clearTimeout(previewStopId)
      finish(true)
    }
  })
}

/**
 * 播放试听音色（≤ 3 秒）
 * @returns ok=true 即成功（可能已降级到 fallback）；fellbackToDefault=true 表示走了降级
 */
export async function previewSound(
  url: string,
  fallbackUrl: string,
): Promise<{ ok: boolean; fellbackToDefault: boolean; error?: string }> {
  const r = await loadAndPlay(url, PREVIEW_MAX_MS)
  if (r.ok) return { ok: true, fellbackToDefault: false }
  if (url === fallbackUrl) return { ok: false, fellbackToDefault: false, error: r.error }
  // 降级播默认
  const r2 = await loadAndPlay(fallbackUrl, PREVIEW_MAX_MS)
  return { ok: r2.ok, fellbackToDefault: true, error: r.error }
}

/**
 * 播放通知音色（事件触发，不限制时长上限到 3s，但仍受加载超时 5s 限制）
 * @returns ok=true 表示有声音播放；ok=false 表示彻底失败（不阻塞 toast/desktop）
 */
export async function playNotificationSound(
  url: string,
  fallbackUrl: string,
): Promise<{ ok: boolean; fellbackToDefault: boolean }> {
  const r = await loadAndPlay(url, AUDIO_TIMEOUT_MS)
  if (r.ok) {
    lastFailedUrl = null
    return { ok: true, fellbackToDefault: false }
  }
  // 同一个失败 url 短时间内不要反复重试
  if (lastFailedUrl === url) {
    return { ok: false, fellbackToDefault: false }
  }
  lastFailedUrl = url
  if (url === fallbackUrl) return { ok: false, fellbackToDefault: false }
  const r2 = await loadAndPlay(fallbackUrl, AUDIO_TIMEOUT_MS)
  return { ok: r2.ok, fellbackToDefault: true }
}
