import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Card, CardContent } from '@/components/ui/card'
import { Network } from '@/network'
import { useEffect, useState } from 'react'
import { Table2, ClipboardList, UtensilsCrossed, TrendingUp, Loader } from 'lucide-react-taro'

export default function AdminIndexPage() {
  const [stats, setStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchStats()
  }, [])

  const fetchStats = async () => {
    try {
      const res = await Network.request({
        url: '/api/statistics/overview'
      })
      if (res.data?.data) {
        setStats(res.data.data)
      }
    } catch (error) {
      console.error('获取统计失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const menuItems = [
    {
      title: '桌台管理',
      icon: Table2,
      color: 'bg-blue-100',
      iconColor: '#3b82f6',
      path: '/pages/admin/tables/index',
      desc: '管理桌台状态和二维码',
    },
    {
      title: '订单管理',
      icon: ClipboardList,
      color: 'bg-green-100',
      iconColor: '#22c55e',
      path: '/pages/admin/orders/index',
      desc: '查看和处理订单',
    },
    {
      title: '菜品管理',
      icon: UtensilsCrossed,
      color: 'bg-purple-100',
      iconColor: '#9333ea',
      path: '/pages/admin/dishes/index',
      desc: '管理菜品和分类',
    },
    {
      title: '数据统计',
      icon: TrendingUp,
      color: 'bg-orange-100',
      iconColor: '#f97316',
      path: '/pages/admin/statistics/index',
      desc: '查看营业数据统计',
    },
  ]

  return (
    <View className="min-h-screen bg-gray-50">
      {/* 顶部统计概览 */}
      <View className="bg-orange-500 text-white px-4 py-6">
        <Text className="block text-lg font-semibold mb-4">数据概览</Text>
        {loading ? (
          <View className="flex justify-center py-4">
            <Loader size={24} className="animate-spin" color="#ffffff" />
          </View>
        ) : (
          <View className="grid grid-cols-2 gap-3">
            <View className="bg-white bg-opacity-20 rounded-lg p-3">
              <Text className="block text-xs opacity-90">今日营业额</Text>
              <Text className="block text-2xl font-bold mt-1">
                ¥{stats?.today_amount || '0.00'}
              </Text>
            </View>
            <View className="bg-white bg-opacity-20 rounded-lg p-3">
              <Text className="block text-xs opacity-90">今日订单数</Text>
              <Text className="block text-2xl font-bold mt-1">
                {stats?.today_count || 0}
              </Text>
            </View>
            <View className="bg-white bg-opacity-20 rounded-lg p-3">
              <Text className="block text-xs opacity-90">总订单数</Text>
              <Text className="block text-2xl font-bold mt-1">
                {stats?.total_orders || 0}
              </Text>
            </View>
            <View className="bg-white bg-opacity-20 rounded-lg p-3">
              <Text className="block text-xs opacity-90">总营业额</Text>
              <Text className="block text-2xl font-bold mt-1">
                ¥{stats?.total_amount || '0.00'}
              </Text>
            </View>
          </View>
        )}
      </View>

      {/* 功能菜单 */}
      <View className="px-4 py-4 -mt-2">
        <Text className="block text-sm font-semibold text-gray-700 mb-3">功能菜单</Text>
        <View className="space-y-3">
          {menuItems.map(item => {
            const Icon = item.icon
            return (
              <Card key={item.title} className="shadow-sm">
                <CardContent className="p-0">
                  <View
                    className="flex items-center gap-4 p-4"
                    onClick={() => Taro.navigateTo({ url: item.path })}
                  >
                    <View className={`w-12 h-12 ${item.color} rounded-xl flex items-center justify-center`}>
                      <Icon size={24} color={item.iconColor} />
                    </View>
                    <View className="flex-1">
                      <Text className="block text-base font-semibold text-gray-900">
                        {item.title}
                      </Text>
                      <Text className="block text-xs text-gray-500 mt-1">
                        {item.desc}
                      </Text>
                    </View>
                    <Text className="text-gray-400">→</Text>
                  </View>
                </CardContent>
              </Card>
            )
          })}
        </View>
      </View>
    </View>
  )
}
