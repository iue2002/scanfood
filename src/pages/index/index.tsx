import { View, Text, Image, ScrollView } from '@tarojs/components'
import { useEffect, useState } from 'react'
import Taro from '@tarojs/taro'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Network } from '@/network'
import { Loader, ScanLine } from 'lucide-react-taro'

interface Dish {
  id: number
  name: string
  price: string
  image_url?: string
  description?: string
  category: string
  status: string
}

interface Category {
  id: number
  name: string
}

const parseTableInfo = (raw: string): { tableId: string; tableNumber: string } | null => {
  const tableIdMatch = raw.match(/(?:^|[?&])table_id=(\d+)/)
  const tableMatch = raw.match(/(?:^|[?&])table=([^&]+)/)
  if (!tableIdMatch || !tableMatch) {
    return null
  }
  return {
    tableId: tableIdMatch[1],
    tableNumber: decodeURIComponent(tableMatch[1]),
  }
}

export default function Index() {
  const [loading, setLoading] = useState(true)
  const [dishes, setDishes] = useState<Dish[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [currentCategory, setCurrentCategory] = useState<string | null>(null)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [categoriesRes, dishesRes] = await Promise.all([
          Network.request({ url: '/api/dishes/categories' }),
          Network.request({ url: '/api/dishes' }),
        ])
        setCategories(categoriesRes.data?.data ?? [])
        const allDishes = dishesRes.data?.data ?? []
        setDishes(allDishes.filter((dish: Dish) => dish.status === 'available'))
      } catch (error) {
        console.error('[首页] 获取菜品失败:', error)
        Taro.showToast({ title: '获取菜品失败', icon: 'none' })
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [])

  const handleScanQRCode = () => {
    if (!([Taro.ENV_TYPE.WEAPP, Taro.ENV_TYPE.TT].includes(Taro.getEnv() as any))) {
      Taro.showToast({ title: '请在微信小程序中扫码', icon: 'none' })
      return
    }

    Taro.scanCode({
      success: ({ result }) => {
        const tableInfo = parseTableInfo(result)
        if (!tableInfo) {
          Taro.showToast({ title: '无效的桌台二维码', icon: 'none' })
          return
        }
        Taro.navigateTo({
          url: `/pages/order/index?table_id=${tableInfo.tableId}&table_number=${encodeURIComponent(tableInfo.tableNumber)}`,
        })
      },
      fail: (error) => {
        console.error('[扫码失败]', error)
        Taro.showToast({ title: '扫码失败', icon: 'none' })
      },
    })
  }

  const filteredDishes = currentCategory ? dishes.filter((d) => d.category === currentCategory) : dishes

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

  return (
    <View className="min-h-screen bg-gray-50 pb-6">
      <View className="bg-orange-500 text-white px-4 pt-5 pb-4">
        <Text className="block text-xl font-semibold">菜品浏览</Text>
        <Text className="block text-sm opacity-90 mt-1">先看菜单，入座后扫码下单</Text>
      </View>

      <View className="bg-white px-4 py-3 border-b">
        <Button className="bg-orange-500 w-full" onClick={handleScanQRCode}>
          <View className="flex items-center gap-2">
            <ScanLine size={16} color="#fff" />
            <Text>扫码点餐</Text>
          </View>
        </Button>
      </View>

      <View className="bg-white px-4 py-2 sticky top-0 z-10 border-b">
        <ScrollView scrollX className="whitespace-nowrap">
          <View className="inline-flex gap-2">
            <View
              className={`px-4 py-2 rounded-full text-sm ${currentCategory === null ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-700'}`}
              onClick={() => setCurrentCategory(null)}
            >
              <Text>全部</Text>
            </View>
            {categories.map((cat) => (
              <View
                key={cat.id}
                className={`px-4 py-2 rounded-full text-sm ${currentCategory === cat.name ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-700'}`}
                onClick={() => setCurrentCategory(cat.name)}
              >
                <Text>{cat.name}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>

      <View className="p-4">
        {filteredDishes.length === 0 ? (
          <View className="text-center py-12">
            <Text className="block text-gray-400">暂无菜品</Text>
          </View>
        ) : (
          filteredDishes.map((dish) => (
            <Card key={dish.id} className="mb-3">
              <CardContent className="p-3">
                <View className="flex gap-3">
                  <View className="flex-shrink-0 w-20 h-20 bg-gray-100 rounded-lg overflow-hidden">
                    {dish.image_url ? (
                      <Image src={dish.image_url} mode="aspectFill" className="w-full h-full" />
                    ) : (
                      <View className="w-full h-full flex items-center justify-center">
                        <Text className="text-2xl text-gray-300">🍽</Text>
                      </View>
                    )}
                  </View>
                  <View className="flex-1 min-w-0">
                    <View className="flex items-center justify-between gap-2">
                      <Text className="block text-base font-semibold text-gray-900 truncate">{dish.name}</Text>
                      <Badge variant="outline">{dish.category || '未分类'}</Badge>
                    </View>
                    {dish.description ? (
                      <Text className="block text-xs text-gray-500 mt-1 line-clamp-2">{dish.description}</Text>
                    ) : null}
                    <Text className="block text-lg font-bold text-orange-600 mt-2">
                      ¥{(Number(dish.price) || 0).toFixed(2)}
                    </Text>
                  </View>
                </View>
              </CardContent>
            </Card>
          ))
        )}
      </View>
    </View>
  )
}
