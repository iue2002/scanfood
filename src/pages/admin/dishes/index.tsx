import { View, Text } from '@tarojs/components'
import { useState, useEffect } from 'react'
import Taro from '@tarojs/taro'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Network } from '@/network'
import { Loader } from 'lucide-react-taro'

interface Dish {
  id: number
  name: string
  price: string
  image_url?: string
  description?: string
  category: string
  status: string
}

export default function DishesPage() {
  const [dishes, setDishes] = useState<Dish[]>([])
  const [loading, setLoading] = useState(true)
  const [activeCategory, setActiveCategory] = useState('all')

  useEffect(() => {
    fetchDishes()
  }, [])

  const fetchDishes = async () => {
    try {
      const res = await Network.request({ url: '/api/dishes' })
      console.log('[菜品列表]', res.data)
      if (res.data?.data) {
        setDishes(res.data.data)
      }
    } catch (error) {
      console.error('获取菜品失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const categories = ['all', ...new Set(dishes.map(d => d.category))]

  const filteredDishes = activeCategory === 'all'
    ? dishes
    : dishes.filter(d => d.category === activeCategory)

  const handleToggleStatus = async (dish: Dish) => {
    const newStatus = dish.status === 'available' ? 'unavailable' : 'available'
    try {
      await Network.request({
        url: `/api/dishes/${dish.id}/status`,
        method: 'PUT',
        data: { status: newStatus }
      })
      Taro.showToast({ title: '更新成功', icon: 'success' })
      fetchDishes()
    } catch (error) {
      Taro.showToast({ title: '更新失败', icon: 'none' })
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
    <View className="min-h-screen bg-gray-50">
      {/* 分类筛选 */}
      <View className="bg-white px-4 py-2 border-b overflow-x-auto">
        <View className="inline-flex gap-2 whitespace-nowrap">
          {categories.map(cat => (
            <View
              key={cat}
              className={`px-3 py-2 rounded-full text-sm ${activeCategory === cat ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600'}`}
              onClick={() => setActiveCategory(cat)}
            >
              <Text>{cat === 'all' ? '全部' : cat}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* 菜品列表 */}
      <View className="p-4 space-y-3">
        {filteredDishes.map(dish => (
          <Card key={dish.id} className="shadow-sm">
            <CardContent className="p-3">
              <View className="flex gap-3">
                <View className="w-20 h-20 bg-gray-100 rounded-lg flex-shrink-0 flex items-center justify-center">
                  {dish.image_url ? (
                    <Text className="text-gray-400 text-xs">图片</Text>
                  ) : (
                    <Text className="text-gray-400 text-xs">暂无图片</Text>
                  )}
                </View>
                <View className="flex-1">
                  <View className="flex justify-between items-start">
                    <Text className="block text-base font-semibold text-gray-900">{dish.name}</Text>
                    <Badge variant={dish.status === 'available' ? 'default' : 'secondary'}>
                      {dish.status === 'available' ? '在售' : '下架'}
                    </Badge>
                  </View>
                  <Text className="block text-xs text-gray-500 mt-1">{dish.category}</Text>
                  <Text className="block text-lg font-bold text-orange-600 mt-2">¥{dish.price}</Text>
                </View>
              </View>
              <View className="flex justify-end gap-2 mt-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleToggleStatus(dish)}
                >
                  <Text>{dish.status === 'available' ? '下架' : '上架'}</Text>
                </Button>
              </View>
            </CardContent>
          </Card>
        ))}

        {filteredDishes.length === 0 && (
          <View className="text-center py-12">
            <Text className="block text-gray-400">暂无菜品</Text>
          </View>
        )}
      </View>
    </View>
  )
}
