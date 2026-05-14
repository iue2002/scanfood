import { View, Text } from '@tarojs/components'
import { useState, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Network } from '@/network'
import { Loader, DollarSign, ShoppingBag } from 'lucide-react-taro'

interface Stats {
  today_amount: string
  today_count: number
  month_amount: string
  month_count: number
  total_amount: string
  total_orders: number
  top_dishes: Array<{
    name: string
    count: number
    amount: string
  }>
}

export default function StatisticsPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchStats()
  }, [])

  const fetchStats = async () => {
    try {
      const res = await Network.request({ url: '/api/statistics/overview' })
      console.log('[统计数据]', res.data)
      if (res.data?.data) {
        setStats(res.data.data)
      }
    } catch (error) {
      console.error('获取统计失败:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <View className="min-h-screen flex items-center justify-center">
        <View className="text-center">
          <Loader size={32} className="animate-spin mx-auto mb-4" color="#f97316" />
          <Text className="block text-gray-500">加载中...</Text>
        </View>
      </View>
    )
  }

  return (
    <View className="min-h-screen bg-gray-50 pb-4">
      {/* 今日数据 */}
      <View className="bg-gradient-to-r from-orange-500 to-amber-500 text-white px-4 py-6">
        <Text className="block text-sm opacity-90 mb-4">今日营业数据</Text>
        <View className="grid grid-cols-2 gap-4">
          <View>
            <Text className="block text-xs opacity-80">营业额</Text>
            <Text className="block text-3xl font-bold mt-1">¥{stats?.today_amount || '0.00'}</Text>
          </View>
          <View>
            <Text className="block text-xs opacity-80">订单数</Text>
            <Text className="block text-3xl font-bold mt-1">{stats?.today_count || 0}</Text>
          </View>
        </View>
      </View>

      {/* 本月数据 */}
      <View className="px-4 -mt-3">
        <Card className="shadow-md">
          <CardContent className="p-4">
            <Text className="block text-sm font-semibold text-gray-700 mb-3">本月累计</Text>
            <View className="grid grid-cols-2 gap-4">
              <View className="bg-green-50 rounded-lg p-3">
                <Text className="block text-xs text-gray-500">营业额</Text>
                <Text className="block text-xl font-bold text-green-600 mt-1">
                  ¥{stats?.month_amount || '0.00'}
                </Text>
              </View>
              <View className="bg-blue-50 rounded-lg p-3">
                <Text className="block text-xs text-gray-500">订单数</Text>
                <Text className="block text-xl font-bold text-blue-600 mt-1">
                  {stats?.month_count || 0}
                </Text>
              </View>
            </View>
          </CardContent>
        </Card>
      </View>

      {/* 总体数据 */}
      <View className="px-4 mt-3">
        <Card className="shadow-sm">
          <CardContent className="p-4">
            <Text className="block text-sm font-semibold text-gray-700 mb-3">历史累计</Text>
            <View className="flex justify-around">
              <View className="text-center">
                <View className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-2">
                  <DollarSign size={20} color="#f97316" />
                </View>
                <Text className="block text-lg font-bold text-gray-900">
                  ¥{stats?.total_amount || '0.00'}
                </Text>
                <Text className="block text-xs text-gray-500 mt-1">总营业额</Text>
              </View>
              <View className="text-center">
                <View className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-2">
                  <ShoppingBag size={20} color="#3b82f6" />
                </View>
                <Text className="block text-lg font-bold text-gray-900">
                  {stats?.total_orders || 0}
                </Text>
                <Text className="block text-xs text-gray-500 mt-1">总订单数</Text>
              </View>
            </View>
          </CardContent>
        </Card>
      </View>

      {/* 热销菜品排行 */}
      <View className="px-4 mt-3">
        <Card className="shadow-sm">
          <CardContent className="p-4">
            <Text className="block text-sm font-semibold text-gray-700 mb-3">热销菜品排行</Text>
            {stats?.top_dishes && stats.top_dishes.length > 0 ? (
              <View className="space-y-2">
                {stats.top_dishes.map((dish, index) => (
                  <View key={index} className="flex items-center gap-3">
                    <View className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                      index === 0 ? 'bg-yellow-400 text-white' :
                      index === 1 ? 'bg-gray-400 text-white' :
                      index === 2 ? 'bg-amber-600 text-white' :
                      'bg-gray-100 text-gray-600'
                    }`}
                    >
                      <Text>{index + 1}</Text>
                    </View>
                    <View className="flex-1">
                      <Text className="block text-sm text-gray-900">{dish.name}</Text>
                      <Text className="block text-xs text-gray-500">销量 {dish.count}</Text>
                    </View>
                    <Text className="text-sm font-semibold text-orange-600">¥{dish.amount}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text className="block text-center text-gray-400 text-sm py-4">暂无数据</Text>
            )}
          </CardContent>
        </Card>
      </View>
    </View>
  )
}
