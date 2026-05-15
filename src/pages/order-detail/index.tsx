import { View, Text } from '@tarojs/components'
import { useState, useEffect } from 'react'
import Taro, { useRouter } from '@tarojs/taro'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Network } from '@/network'
import { Loader, Clock, Circle } from 'lucide-react-taro'

interface Order {
  id: number
  table_id: number
  order_number: string
  total_amount: string
  status: string
  remark?: string
  created_at: string
  tables: {
    table_number: string
  }
  order_items: Array<{
    id: number
    dish_name: string
    spec_name?: string
    quantity: number
    price: string
    subtotal: string
  }>
}

const statusMap: Record<string, { label: string; icon: any }> = {
  submitted: { label: '已提交', icon: Clock },
  printed: { label: '已打印', icon: Circle },
  settled: { label: '已结账', icon: Circle },
  cancelled: { label: '已取消', icon: Circle },
  refunded: { label: '已退款', icon: Circle },
}

export default function OrderDetailPage() {
  const router = useRouter()
  const { id } = router.params

  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (id) {
      fetchOrder()
    }
  }, [id])

  const fetchOrder = async () => {
    try {
      const res = await Network.request({
        url: `/api/orders/${id}`
      })
      console.log('[订单详情]', res.data)
      if (res.data?.data) {
        setOrder(res.data.data)
      }
    } catch (error) {
      console.error('获取订单失败:', error)
      Taro.showToast({ title: '获取订单失败', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }

  const formatTime = (timeStr: string) => {
    const date = new Date(timeStr)
    return `${date.getMonth() + 1}月${date.getDate()}日 ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`
  }

  if (loading) {
    return (
      <View className="min-h-screen flex items-center justify-center bg-gray-50">
        <View className="text-center">
          <Loader size={32} className="animate-spin mx-auto mb-4" color="#f97316" />
          <Text className="block text-gray-500">加载中...</Text>
        </View>
      </View>
    )
  }

  if (!order) {
    return (
      <View className="min-h-screen flex items-center justify-center bg-gray-50">
        <Text className="block text-gray-400">订单不存在</Text>
      </View>
    )
  }

  const statusInfo = statusMap[order.status] || statusMap.submitted
  const StatusIcon = statusInfo.icon

  return (
    <View className="min-h-screen bg-gray-50 pb-4">
      {/* 顶部状态栏 */}
      <View className="bg-orange-500 text-white px-4 py-6 text-center">
        <StatusIcon size={48} className="mx-auto mb-3 opacity-90" />
        <Text className="block text-2xl font-bold mb-2">{statusInfo.label}</Text>
        <Text className="block text-sm opacity-90">
          桌台：{order.tables?.table_number || '未知'}
        </Text>
      </View>

      {/* 订单信息卡片 */}
      <View className="px-4 -mt-4">
        <Card className="mb-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">订单信息</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <View className="space-y-2">
              <View className="flex justify-between">
                <Text className="text-gray-500 text-sm">订单号</Text>
                <Text className="text-gray-900 text-sm font-mono">{order.order_number}</Text>
              </View>
              <View className="flex justify-between">
                <Text className="text-gray-500 text-sm">下单时间</Text>
                <Text className="text-gray-900 text-sm">{formatTime(order.created_at)}</Text>
              </View>
              {order.remark && (
                <View className="flex justify-between">
                  <Text className="text-gray-500 text-sm">备注</Text>
                  <Text className="text-gray-900 text-sm">{order.remark}</Text>
                </View>
              )}
            </View>
          </CardContent>
        </Card>

        {/* 菜品明细卡片 */}
        <Card className="mb-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">菜品明细</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <View className="space-y-3">
              {order.order_items.map((item, index) => (
                <View key={item.id}>
                  <View className="flex justify-between items-start">
                    <View className="flex-1">
                      <Text className="block text-gray-900 font-medium">{item.dish_name}</Text>
                      {item.spec_name && (
                        <Badge variant="outline" className="mt-1">
                          {item.spec_name}
                        </Badge>
                      )}
                    </View>
                    <View className="text-right">
                      <Text className="block text-gray-500 text-xs">
                        ¥{item.price} × {item.quantity}
                      </Text>
                      <Text className="block text-gray-900 font-semibold">
                        ¥{item.subtotal}
                      </Text>
                    </View>
                  </View>
                  {index < order.order_items.length - 1 && (
                    <Separator className="mt-3" />
                  )}
                </View>
              ))}
            </View>
          </CardContent>
        </Card>

        {/* 总计卡片 */}
        <Card>
          <CardContent className="p-4">
            <View className="flex justify-between items-center">
              <Text className="text-gray-700 font-semibold">合计</Text>
              <Text className="text-2xl font-bold text-orange-600">
                ¥{order.total_amount}
              </Text>
            </View>
          </CardContent>
        </Card>
      </View>

      {/* 底部操作按钮 */}
      {order.status === 'submitted' || order.status === 'printed' ? (
        <View className="px-4 mt-4">
          <Button
            className="w-full bg-orange-500"
            onClick={() => {
              // 继续加餐
              Taro.navigateTo({
                url: `/pages/order/index?table_id=${order.table_id}&table_number=${encodeURIComponent(order.tables?.table_number || '')}`
              })
            }}
          >
            <Text>继续加餐</Text>
          </Button>
        </View>
      ) : null}

      {/* 温馨提示 */}
      <View className="px-4 mt-6">
        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="p-3">
            <Text className="block text-amber-800 text-xs leading-relaxed">
              温馨提示：{'\n'}
              • 订单已自动打印至厨房，请耐心等待{'\n'}
              • 如需加餐或减餐，请联系服务员{'\n'}
              • 用餐完毕后请前往前台结账
            </Text>
          </CardContent>
        </Card>
      </View>
    </View>
  )
}
