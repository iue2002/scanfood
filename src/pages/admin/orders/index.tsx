import { View, Text, ScrollView } from '@tarojs/components'
import { useState, useEffect } from 'react'
import Taro from '@tarojs/taro'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Network } from '@/network'
import { Loader } from 'lucide-react-taro'

interface Order {
  id: number
  order_number: string
  total_amount: string
  status: string
  created_at: string
  tables: {
    table_number: string
  }
}

const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  submitted: { label: '已提交', variant: 'default' },
  printed: { label: '已打印', variant: 'secondary' },
  settled: { label: '已结账', variant: 'outline' },
  cancelled: { label: '已取消', variant: 'destructive' },
  refunded: { label: '已退款', variant: 'destructive' },
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('all')

  useEffect(() => {
    fetchOrders()
  }, [activeTab])

  const fetchOrders = async () => {
    setLoading(true)
    try {
      const params = activeTab !== 'all' ? `?status=${activeTab}` : ''
      const res = await Network.request({ url: `/api/orders${params}` })
      console.log('[订单列表]', res.data)
      if (res.data?.data) {
        setOrders(res.data.data)
      }
    } catch (error) {
      console.error('获取订单失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const formatTime = (timeStr: string) => {
    const date = new Date(timeStr)
    return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`
  }

  const handleOrderClick = (orderId: number) => {
    Taro.navigateTo({ url: `/pages/order-detail/index?id=${orderId}` })
  }

  return (
    <View className="min-h-screen bg-gray-50">
      {/* 标签筛选 */}
      <View className="bg-white px-4 py-2 border-b">
        <ScrollView scrollX className="whitespace-nowrap">
          <View className="inline-flex gap-2">
            {['all', 'submitted', 'printed', 'settled', 'cancelled'].map(tab => (
              <View
                key={tab}
                className={`px-4 py-2 rounded-full text-sm ${activeTab === tab ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600'}`}
                onClick={() => setActiveTab(tab)}
              >
                <Text>{tab === 'all' ? '全部' : statusMap[tab]?.label}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>

      {/* 订单列表 */}
      <View className="p-4">
        {loading ? (
          <View className="text-center py-8">
            <Loader size={32} className="animate-spin mx-auto mb-4" color="#f97316" />
            <Text className="block text-gray-500">加载中...</Text>
          </View>
        ) : orders.length === 0 ? (
          <View className="text-center py-12">
            <Text className="block text-gray-400">暂无订单</Text>
          </View>
        ) : (
          <View className="space-y-3">
            {orders.map(order => {
              const status = statusMap[order.status] || statusMap.submitted
              return (
                <Card key={order.id} className="shadow-sm" onClick={() => handleOrderClick(order.id)}>
                  <CardContent className="p-4">
                    <View className="flex justify-between items-start mb-2">
                      <View>
                        <Text className="block text-base font-semibold text-gray-900">
                          {order.tables?.table_number || '未知'}号桌
                        </Text>
                        <Text className="block text-xs text-gray-500 mt-1 font-mono">
                          {order.order_number}
                        </Text>
                      </View>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </View>
                    <View className="flex justify-between items-center mt-3">
                      <Text className="text-xs text-gray-500">{formatTime(order.created_at)}</Text>
                      <Text className="text-lg font-bold text-orange-600">¥{order.total_amount}</Text>
                    </View>
                  </CardContent>
                </Card>
              )
            })}
          </View>
        )}
      </View>
    </View>
  )
}
