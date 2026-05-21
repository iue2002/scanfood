import { useCallback } from 'react'
import { useModal } from './ModalProvider'
import { useWebSocketEvent } from './WebSocketProvider'
import { showNotification } from '@/utils/notification'

/**
 * 全局通知中心：唯一的 WebSocket 通知 toast/桌面通知 入口
 * 各业务页面只通过 useWebSocketEvent 订阅自己关心的数据刷新事件，
 * 不再各自 toast，避免同事件被多个页面重复弹窗。
 */
export default function NotificationCenter() {
  const { showToast } = useModal()

  // 订单状态变化（提交 / 结账 / 取消）
  useWebSocketEvent(
    'orderStatusChanged',
    useCallback(
      (data: any) => {
        if (!data) return
        const tableNum = data.tables?.table_number || data.table_id
        const orderNo = data.order_number || `#${data.id}`

        if (data.status === 'submitted') {
          showToast(`新订单 ${orderNo}（${tableNum}号桌）`, 'success')
          showNotification(`${tableNum}号桌 新订单`, {
            body: `订单 ${orderNo}，总额 ¥${data.total_amount || '-'}`,
          })
        } else if (data.status === 'settled') {
          showToast(`${orderNo}（${tableNum}号桌）已结账`, 'info')
        } else if (data.status === 'cancelled') {
          showToast(`${orderNo}（${tableNum}号桌）已取消`, 'warning')
        }
      },
      [showToast]
    )
  )

  // 退款申请
  useWebSocketEvent(
    'refundCreated',
    useCallback(
      (data: any) => {
        if (!data) return
        showToast(`收到退款申请 ¥${data.amount}（订单 #${data.order_id}）`, 'warning')
        showNotification('收到退款申请', {
          body: `订单 #${data.order_id} 申请退款 ¥${data.amount}，原因：${data.reason || '-'}`,
        })
      },
      [showToast]
    )
  )

  // 退款审核结果
  useWebSocketEvent(
    'refundUpdated',
    useCallback(
      (data: any) => {
        if (!data) return
        const label = data.status === 'approved' ? '已通过' : '已拒绝'
        showToast(`退款申请${label}`, 'info')
      },
      [showToast]
    )
  )

  return null
}
