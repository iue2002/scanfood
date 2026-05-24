import { useEffect, useRef, useState } from 'react'
import { Download, X, Loader, ImageOff } from 'lucide-react'
import { resolveImageUrl } from '@/utils/image-url'

interface TablePosterModalProps {
  open: boolean
  table: { id: number; table_number: string; qr_code_url: string | null } | null
  storeName?: string
  onClose: () => void
}

const POSTER_W = 750
const POSTER_H = 1334
const QR_SIZE = 480

/**
 * 桌台二维码海报弹窗
 * - 在 canvas 上绘制完整海报（顶部装饰 + 餐厅名 + 桌号大字 + 二维码 + 文案）
 * - 点击"保存海报"导出 PNG（web 端用 <a download>）
 * - 海报尺寸固定 750×1334（符合微信朋友圈 / 社交媒体海报标准比例）
 */
export default function TablePosterModal({
  open,
  table,
  storeName = '伊美轩',
  onClose,
}: TablePosterModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [previewUrl, setPreviewUrl] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')

  useEffect(() => {
    if (!open || !table) return
    drawPoster()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, table])

  const drawPoster = async () => {
    if (!table || !canvasRef.current) return
    const canvas = canvasRef.current
    canvas.width = POSTER_W
    canvas.height = POSTER_H
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    setLoading(true)
    setError('')

    // 1. 背景：微信品牌绿渐变
    const gradient = ctx.createLinearGradient(0, 0, 0, POSTER_H)
    gradient.addColorStop(0, '#07C160')   // 微信品牌色
    gradient.addColorStop(0.5, '#10AD51') // 渐深
    gradient.addColorStop(1, '#048A45')   // 底部更深
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, POSTER_W, POSTER_H)

    // 2. 顶部装饰圆斑
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)'
    ctx.beginPath()
    ctx.arc(120, 80, 200, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(POSTER_W - 100, 240, 150, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(POSTER_W - 80, POSTER_H - 80, 220, 0, Math.PI * 2)
    ctx.fill()

    // 3. 餐厅名 + 副标题
    ctx.fillStyle = '#FFFFFF'
    ctx.font = '600 56px "PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(storeName, POSTER_W / 2, 110)
    ctx.font = '300 28px "PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
    ctx.fillText('扫码点餐 · 自在用餐', POSTER_W / 2, 190)

    // 4. 中部白卡（圆角矩形）
    const cardX = 60
    const cardY = 270
    const cardW = POSTER_W - 120
    const cardH = 880
    drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 32)
    ctx.fillStyle = '#FFFFFF'
    ctx.fill()

    // 5. 桌号
    ctx.fillStyle = '#94A3B8'
    ctx.font = '400 28px "PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('您的桌号', POSTER_W / 2, cardY + 60)

    ctx.fillStyle = '#0F172A'
    ctx.font = '700 160px "PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.fillText(table.table_number, POSTER_W / 2, cardY + 110)

    // 桌号下方装饰线
    const lineY = cardY + 290
    const lineStartX = POSTER_W / 2 - 80
    const lineEndX = POSTER_W / 2 + 80
    const dotX = POSTER_W / 2
    // 左线
    ctx.strokeStyle = '#E2E8F0'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(lineStartX, lineY)
    ctx.lineTo(dotX - 16, lineY)
    ctx.stroke()
    // 右线
    ctx.beginPath()
    ctx.moveTo(dotX + 16, lineY)
    ctx.lineTo(lineEndX, lineY)
    ctx.stroke()
    // 中点（微信品牌绿）
    ctx.fillStyle = '#07C160'
    ctx.beginPath()
    ctx.arc(dotX, lineY, 8, 0, Math.PI * 2)
    ctx.fill()

    // 6. 提示
    ctx.fillStyle = '#64748B'
    ctx.font = '400 30px "PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.fillText('请扫描下方二维码点餐', POSTER_W / 2, lineY + 30)

    // 7. 二维码
    const qrUrl = resolveImageUrl(table.qr_code_url)
    const qrX = (POSTER_W - QR_SIZE) / 2
    const qrY = lineY + 80

    // 二维码外框（浅灰）
    drawRoundedRect(ctx, qrX - 20, qrY - 20, QR_SIZE + 40, QR_SIZE + 40, 24)
    ctx.fillStyle = '#F8FAFC'
    ctx.fill()

    if (qrUrl) {
      try {
        const qrImg = await loadImage(qrUrl)
        ctx.drawImage(qrImg, qrX, qrY, QR_SIZE, QR_SIZE)
      } catch (e) {
        ctx.fillStyle = '#FEE2E2'
        drawRoundedRect(ctx, qrX, qrY, QR_SIZE, QR_SIZE, 16)
        ctx.fill()
        ctx.fillStyle = '#EF4444'
        ctx.font = '400 28px "PingFang SC", sans-serif'
        ctx.fillText('二维码加载失败', POSTER_W / 2, qrY + QR_SIZE / 2 - 14)
        setError('二维码加载失败，请检查网络或先生成二维码')
      }
    } else {
      ctx.fillStyle = '#FEF3C7'
      drawRoundedRect(ctx, qrX, qrY, QR_SIZE, QR_SIZE, 16)
      ctx.fill()
      ctx.fillStyle = '#92400E'
      ctx.font = '400 28px "PingFang SC", sans-serif'
      ctx.fillText('暂无二维码', POSTER_W / 2, qrY + QR_SIZE / 2 - 14)
      ctx.font = '300 22px "PingFang SC", sans-serif'
      ctx.fillText('请先在桌台管理生成二维码', POSTER_W / 2, qrY + QR_SIZE / 2 + 18)
    }

    // 8. 底部文案
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'
    ctx.font = '400 24px "PingFang SC", sans-serif'
    ctx.fillText('微信扫一扫 · 在线点餐 · 自助下单', POSTER_W / 2, POSTER_H - 90)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'
    ctx.font = '400 20px "PingFang SC", sans-serif'
    ctx.fillText(`Powered by ${storeName}`, POSTER_W / 2, POSTER_H - 50)

    setPreviewUrl(canvas.toDataURL('image/png', 0.95))
    setLoading(false)
  }

  const handleDownload = () => {
    if (!previewUrl || !table) return
    const a = document.createElement('a')
    a.href = previewUrl
    a.download = `桌台${table.table_number}号-点餐二维码.png`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  if (!open || !table) return null

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-md max-h-[92vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-100 shrink-0">
          <div>
            <h3 className="text-base font-semibold text-[#0F172A]">桌台二维码海报</h3>
            <p className="text-xs text-[#94A3B8] mt-0.5">{table.table_number} 号桌</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[#94A3B8] hover:text-[#0F172A] hover:bg-gray-100 rounded-lg cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto bg-[#F8FAFC] p-4">
          <div className="flex items-center justify-center min-h-[400px]">
            {loading ? (
              <div className="flex flex-col items-center gap-2 text-[#94A3B8]">
                <Loader size={32} className="animate-spin" />
                <span className="text-sm">生成中...</span>
              </div>
            ) : previewUrl ? (
              <img
                src={previewUrl}
                alt="桌台海报预览"
                className="w-full max-w-[320px] rounded-xl shadow-lg"
              />
            ) : error ? (
              <div className="flex flex-col items-center gap-2 text-[#EF4444]">
                <ImageOff size={32} />
                <span className="text-sm">{error}</span>
              </div>
            ) : null}
          </div>
        </div>

        <div className="p-4 border-t border-gray-100 shrink-0 space-y-2">
          {error && (
            <p className="text-xs text-[#EF4444] text-center">{error}</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 bg-[#F1F5F9] text-[#334155] rounded-lg text-sm font-medium hover:bg-[#E2E8F0] transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              onClick={handleDownload}
              disabled={!previewUrl || loading}
              className="flex-1 py-2.5 bg-[#2563EB] text-white rounded-lg text-sm font-medium hover:bg-[#1D4ED8] transition-colors flex items-center justify-center gap-1.5 disabled:opacity-60 cursor-pointer"
            >
              <Download size={14} />
              保存海报
            </button>
          </div>
        </div>

        <canvas ref={canvasRef} style={{ display: 'none' }} />
      </div>
    </div>
  )
}

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous' // 支持跨域 canvas 导出
    img.onload = () => resolve(img)
    img.onerror = (e) => reject(e)
    img.src = src
  })
}
