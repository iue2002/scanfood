import { useCallback, useEffect, useState } from 'react'
import { useModal } from './ModalProvider'
import { useWebSocketEvent } from './WebSocketProvider'
import { showNotification } from '@/utils/notification'
import { decideNotificationChannels } from '@/notif/notification-decision'
import type { DesktopEvent } from '@/notif/notification-decision'
import {
  getNotifPref,
  loadNotifPref,
  listSounds,
  subscribeNotifPref,
} from '@/notif/notif-pref-store'
import type { SoundEntry } from '@/notif/notif-pref-store'
import { playNotificationSound } from '@/notif/audio-player'
import { useAuthStore } from '@/stores/auth'

/**
 * 全局通知中心：唯一的 WebSocket 通知 toast/桌面通知/声音 入口
 *
 * 业务页面只通过 useWebSocketEvent 订阅自己关心的数据刷新事件，
 * 不再各自 toast，避免同事件被多页面重复弹窗。
 *
 * 与本地操作的去重机制：
 *   业务页面成功执行结账/取消等动作后调 markLocalAction('order:settled:{orderId}')，
 *   在 4 秒窗口内 NotificationCenter 收到对应 ws 推送时静默，避免和同步反馈语义重复。
 *
 * 通知偏好 (M3)：
 *   - sound_enabled / sound_id：决定是否播放声音以及播放哪个音色
 *   - desktop_events：决定哪些事件触发桌面通知
 *   - 关键不变量：声音失败不抑制 toast 与桌面通知（Property 12）
 */
export default function NotificationCenter() {
  const { showToast, hasRecentLocalAction } = useModal()
  const isLoggedIn = useAuthStore((s) => !!s.token)

  const [sounds, setSounds] = useState<SoundEntry[]>([])
  const [, forcePrefRefresh] = useState(0)

  // 登录后加载偏好 + 音色清单（未登录或登录失败时使用 localStorage / 默认值）
  useEffect(() => {
    if (!isLoggedIn) return
    loadNotifPref().catch(() => { /* loadNotifPref 内部已 fallback 到 cached */ })
    listSounds().then(setSounds).catch(() => setSounds([]))
    const unsub = subscribeNotifPref(() => forcePrefRefresh((n) => n + 1))
    return unsub
  }, [isLoggedIn])

  const handleEvent = useCallback(
    (event: DesktopEvent, params: { toastMsg: string; toastType: 'success' | 'info' | 'warning' | 'error'; desktopTitle: string; desktopBody: string }) => {
      const pref = getNotifPref()
      const permission: 'granted' | 'denied' | 'default' =
        typeof Notification !== 'undefined' ? Notification.permission : 'denied'

      const decision = decideNotificationChannels(event, pref, /* soundFailed */ false, permission)

      // 1) toast 始终展示（决策已保证 showToast=true）
      if (decision.showToast) {
        showToast(params.toastMsg, params.toastType)
      }

      // 2) 桌面通知（按权限 + 偏好）
      if (decision.showDesktop) {
        showNotification(params.desktopTitle, { body: params.desktopBody })
      }

      // 3) 声音（按偏好），失败仅记日志，不影响上面两个通道
      if (decision.playSound) {
        const entry = sounds.find((s) => s.id === pref.sound_id)
        const fallback = sounds.find((s) => s.id === 'default')
        const url = entry?.url ?? fallback?.url
        const fbUrl = fallback?.url ?? url
        if (url && fbUrl) {
          playNotificationSound(url, fbUrl).catch(() => { /* 声音失败不影响通知 */ })
        }
      }
    },
    [sounds, showToast],
  )

  // 订单状态变化（提交 / 结账 / 取消）
  useWebSocketEvent(
    'orderStatusChanged',
    useCallback(
      (data: any) => {
        if (!data) return
        const isTakeaway = data.order_type === 'takeaway'
        const tableNum = data.tables?.table_number || data.table_id
        const tableLabel = isTakeaway ? '🛍️ 外带' : `${tableNum}号桌`
        const orderNo = data.order_number || `#${data.id}`

        const localKey = `order:${data.status}:${data.id}`
        if (hasRecentLocalAction(localKey)) {
          return
        }

        if (data.status === 'submitted') {
          handleEvent('NEW_ORDER', {
            toastMsg: `新订单 ${orderNo}（${tableLabel}）`,
            toastType: 'success',
            desktopTitle: `${tableLabel} 新订单`,
            desktopBody: `订单 ${orderNo}，总额 ¥${data.total_amount || '-'}`,
          })
        } else if (data.status === 'settled') {
          showToast(`${orderNo}（${tableLabel}）已结账`, 'info')
        } else if (data.status === 'cancelled') {
          showToast(`${orderNo}（${tableLabel}）已取消`, 'warning')
        }
      },
      [showToast, hasRecentLocalAction, handleEvent]
    )
  )

  // 订单内容更新（加餐 / 商家加菜等）
  useWebSocketEvent(
    'orderUpdated',
    useCallback(
      (data: any) => {
        if (!data) return
        const isTakeaway = data.order_type === 'takeaway'
        const tableNum = data.tables?.table_number || data.table_id
        const tableLabel = isTakeaway ? '🛍️ 外带' : `${tableNum}号桌`
        const orderNo = data.order_number || `#${data.id}`

        const localKey = `order:updated:${data.id}`
        if (hasRecentLocalAction(localKey)) return

        handleEvent('ADD_ITEM', {
          toastMsg: `${tableLabel} 加餐 ${orderNo}`,
          toastType: 'success',
          desktopTitle: `${tableLabel} 加餐`,
          desktopBody: `订单 ${orderNo} 新增菜品，总额 ¥${data.total_amount || '-'}`,
        })
      },
      [hasRecentLocalAction, handleEvent]
    )
  )

  // 退款申请
  useWebSocketEvent(
    'refundCreated',
    useCallback(
      (data: any) => {
        if (!data) return
        const localKey = `refund:created:${data.id || data.order_id}`
        if (hasRecentLocalAction(localKey)) return
        handleEvent('REFUND', {
          toastMsg: `收到退款申请 ¥${data.amount}（订单 #${data.order_id}）`,
          toastType: 'warning',
          desktopTitle: '收到退款申请',
          desktopBody: `订单 #${data.order_id} 申请退款 ¥${data.amount}，原因：${data.reason || '-'}`,
        })
      },
      [hasRecentLocalAction, handleEvent]
    )
  )

  // 退款审核结果（仅 toast，不接入声音/桌面）
  useWebSocketEvent(
    'refundUpdated',
    useCallback(
      (data: any) => {
        if (!data) return
        const localKey = `refund:${data.status}:${data.id}`
        if (hasRecentLocalAction(localKey)) return
        const label = data.status === 'approved' ? '已通过' : '已拒绝'
        showToast(`退款申请${label}`, 'info')
      },
      [showToast, hasRecentLocalAction]
    )
  )

  // ============ M5: mop:* 打印相关事件 ============
  // 浏览器打印：后端 BROWSER provider 把 HTML 推过来，前端弹打印窗
  useWebSocketEvent(
    'mop:browser-print',
    useCallback(
      (data: any) => {
        if (!data || typeof data.html !== 'string') return
        try {
          const w = window.open('', '_blank', 'width=420,height=640')
          if (!w) {
            showToast('浏览器打印窗口被拦截，请允许弹窗', 'warning')
            return
          }
          const css = `
            <style>
              body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; padding: 8px; }
              .ticket { width: ${data.width === '58mm' ? '58mm' : '80mm'}; margin: 0 auto; }
              .store { font-size: 16px; font-weight: bold; text-align: center; margin-bottom: 8px; }
              .row { display: flex; justify-content: space-between; padding: 2px 0; font-size: 12px; }
              .row.total { font-size: 14px; font-weight: bold; padding-top: 6px; }
              .item { display: flex; justify-content: space-between; padding: 2px 0; font-size: 12px; }
              .hr { border-top: 1px dashed #94A3B8; margin: 4px 0; }
              .empty { text-align: center; color: #94A3B8; padding: 4px; font-size: 12px; }
              @media print { body { padding: 0; } }
            </style>
          `
          w.document.open()
          w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${data.printerName ?? '小票'}</title>${css}</head><body>${data.html}</body></html>`)
          w.document.close()
          // 等内容渲染后再打印
          setTimeout(() => {
            try { w.print() } catch { /* ignore */ }
          }, 200)
        } catch {
          showToast('浏览器打印失败', 'error')
        }
      },
      [showToast]
    )
  )

  // 打印失败告警（owner / manager 的全局 toast + desktop）
  useWebSocketEvent(
    'mop:printer-error',
    useCallback(
      (data: any) => {
        if (!data) return
        const printerName = data.printerName || `打印机#${data.printerId}`
        const orderTag = data.orderId ? `（订单 #${data.orderId}）` : ''
        showToast(`打印失败：${printerName} - ${data.errorCode || '未知错误'}${orderTag}`, 'error')
        showNotification(`${printerName} 打印失败`, {
          body: `${data.errorCode || '未知错误'}${data.errorMessage ? ' · ' + data.errorMessage : ''}${orderTag}`,
        })
      },
      [showToast]
    )
  )

  return null
}
