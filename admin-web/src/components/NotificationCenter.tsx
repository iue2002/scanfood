import { useCallback } from 'react'
import { useModal } from './ModalProvider'
import { useWebSocketEvent } from './WebSocketProvider'
import { showNotification } from '@/utils/notification'

/**
 * 全局通知中心：唯一的 WebSocket 通知 toast/桌面通知 入口
 * 业务页面只通过 useWebSocketEvent 订阅自己关心的数据刷新事件，
 * 不再各自 toast，避免同事件被多页面重复弹窗。
 *
 * 与本地操作的去重机制：
 * 业务页面成功执行结账/取消等动作后调 markLocalAction('order:settled:{orderId}')，
 * 在 4 秒窗口内 NotificationCenter 收到对应 ws 推送时静默，避免和同步反馈语义重复。
 */
export default function NotificationCenter() {
  const { showToast, hasRecentLocalAction } = useModal()

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

        // 自触发的状态变化（同窗口内点击产生）静默，避免与本地同步反馈重复
        const localKey = `order:${data.status}:${data.id}`
        if (hasRecentLocalAction(localKey)) {
          return
        }

        if (data.status === 'submitted') {
          showToast(`新订单 ${orderNo}（${tableLabel}）`, 'success')
          showNotification(`${tableLabel} 新订单`, {
            body: `订单 ${orderNo}，总额 ¥${data.total_amount || '-'}`,
          })
        } else if (data.status === 'settled') {
          showToast(`${orderNo}（${tableLabel}）已结账`, 'info')
        } else if (data.status === 'cancelled') {
          showToast(`${orderNo}（${tableLabel}）已取消`, 'warning')
        }
      },
      [showToast, hasRecentLocalAction]
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
        showToast(`收到退款申请 ¥${data.amount}（订单 #${data.order_id}）`, 'warning')
        showNotification('收到退款申请', {
          body: `订单 #${data.order_id} 申请退款 ¥${data.amount}，原因：${data.reason || '-'}`,
        })
      },
      [showToast, hasRecentLocalAction]
    )
  )

  // 退款审核结果
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
