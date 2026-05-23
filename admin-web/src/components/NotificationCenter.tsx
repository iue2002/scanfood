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

  return null
}
