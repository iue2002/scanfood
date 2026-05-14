import { View, Text, Image, ScrollView } from '@tarojs/components'
import { useState, useEffect } from 'react'
import Taro, { useRouter } from '@tarojs/taro'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Network } from '@/network'
import { ShoppingCart, Plus, Minus, Loader } from 'lucide-react-taro'

interface Dish {
  id: number
  name: string
  price: string
  image_url?: string
  description?: string
  category: string
  status: string
  dish_specs?: Array<{
    id: number
    spec_name: string
    price: string
  }>
}

interface CartItem {
  dish_id: number
  dish_name: string
  spec_id?: number
  spec_name?: string
  price: number
  quantity: number
}

export default function OrderPage() {
  const router = useRouter()
  const { table_id, table_number } = router.params

  const [dishes, setDishes] = useState<Dish[]>([])
  const [categories, setCategories] = useState<Array<{ id: number; name: string }>>([])
  const [currentCategory, setCurrentCategory] = useState<string | null>(null)
  const [cart, setCart] = useState<CartItem[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // 获取菜品数据
  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      // 获取菜品分类
      const categoriesRes = await Network.request({
        url: '/api/dishes/categories'
      })
      if (categoriesRes.data?.data) {
        setCategories(categoriesRes.data.data)
      }

      // 获取所有菜品
      const dishesRes = await Network.request({
        url: '/api/dishes'
      })
      if (dishesRes.data?.data) {
        const availableDishes = dishesRes.data.data.filter((d: Dish) => d.status === 'available')
        setDishes(availableDishes)
      }
    } catch (error) {
      console.error('获取菜品失败:', error)
      Taro.showToast({ title: '获取菜品失败', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }

  // 添加到购物车
  const addToCart = (dish: Dish, spec?: { id: number; spec_name: string; price: string }) => {
    const price = spec ? parseFloat(spec.price) : parseFloat(dish.price)
    const specId = spec?.id
    const specName = spec?.spec_name

    setCart(prev => {
      const existing = prev.find(
        item => item.dish_id === dish.id && item.spec_id === specId
      )

      if (existing) {
        return prev.map(item =>
          item.dish_id === dish.id && item.spec_id === specId
            ? { ...item, quantity: item.quantity + 1 }
            : item
        )
      }

      return [...prev, {
        dish_id: dish.id,
        dish_name: dish.name,
        spec_id: specId,
        spec_name: specName,
        price,
        quantity: 1,
      }]
    })
  }

  // 从购物车减少
  const removeFromCart = (dishId: number, specId?: number) => {
    setCart(prev => {
      const existing = prev.find(
        item => item.dish_id === dishId && item.spec_id === specId
      )

      if (existing && existing.quantity > 1) {
        return prev.map(item =>
          item.dish_id === dishId && item.spec_id === specId
            ? { ...item, quantity: item.quantity - 1 }
            : item
        )
      }

      return prev.filter(
        item => !(item.dish_id === dishId && item.spec_id === specId)
      )
    })
  }

  // 获取购物车中某个菜品数量
  const getCartQuantity = (dishId: number, specId?: number) => {
    const item = cart.find(i => i.dish_id === dishId && i.spec_id === specId)
    return item?.quantity || 0
  }

  // 计算总价
  const getTotalPrice = () => {
    return cart.reduce((sum, item) => sum + item.price * item.quantity, 0)
  }

  // 计算总数量
  const getTotalQuantity = () => {
    return cart.reduce((sum, item) => sum + item.quantity, 0)
  }

  // 提交订单
  const handleSubmitOrder = async () => {
    if (cart.length === 0) {
      Taro.showToast({ title: '请先选择菜品', icon: 'none' })
      return
    }

    if (!table_id) {
      Taro.showToast({ title: '桌台信息错误', icon: 'none' })
      return
    }

    setSubmitting(true)
    try {
      const userInfo = Taro.getStorageSync('userInfo')
      const orderData = {
        table_id: parseInt(table_id as string, 10),
        items: cart.map(item => ({
          dish_id: item.dish_id,
          spec_id: item.spec_id,
          dish_name: item.dish_name,
          spec_name: item.spec_name,
          quantity: item.quantity,
          price: item.price,
        })),
        user_id: userInfo?.id,
      }

      console.log('[提交订单]', orderData)
      const res = await Network.request({
        url: '/api/orders',
        method: 'POST',
        data: orderData
      })
      console.log('[订单响应]', res.data)

      if (res.data?.data) {
        Taro.showToast({ title: '下单成功', icon: 'success' })
        // 清空购物车
        setCart([])
        // 跳转到订单详情
        setTimeout(() => {
          Taro.navigateTo({
            url: `/pages/order-detail/index?id=${res.data.data.id}`
          })
        }, 1500)
      }
    } catch (error: any) {
      console.error('[提交订单错误]', error)
      Taro.showToast({ title: error.message || '下单失败', icon: 'none' })
    } finally {
      setSubmitting(false)
    }
  }

  // 过滤菜品
  const filteredDishes = currentCategory
    ? dishes.filter(d => d.category === currentCategory)
    : dishes

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
    <View className="min-h-screen bg-gray-50 pb-24">
      {/* 顶部桌台信息 */}
      <View className="bg-orange-500 text-white px-4 py-3">
        <Text className="block text-lg font-semibold">桌台：{table_number || '未知'}</Text>
        <Text className="block text-sm opacity-90">请选择菜品后提交订单</Text>
      </View>

      {/* 菜品分类标签 */}
      <View className="bg-white px-4 py-2 sticky top-0 z-10 border-b">
        <ScrollView scrollX className="whitespace-nowrap">
          <View className="inline-flex gap-2">
            <View
              className={`px-4 py-2 rounded-full text-sm ${
                currentCategory === null ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-700'
              }`}
              onClick={() => setCurrentCategory(null)}
            >
              <Text>全部</Text>
            </View>
            {categories.map(cat => (
              <View
                key={cat.id}
                className={`px-4 py-2 rounded-full text-sm ${
                  currentCategory === cat.name ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-700'
                }`}
                onClick={() => setCurrentCategory(cat.name)}
              >
                <Text>{cat.name}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>

      {/* 菜品列表 */}
      <View className="p-4">
        {filteredDishes.length === 0 ? (
          <View className="text-center py-12">
            <Text className="block text-gray-400">暂无菜品</Text>
          </View>
        ) : (
          filteredDishes.map(dish => {
            const hasSpecs = dish.dish_specs && dish.dish_specs.length > 0
            const totalPrice = hasSpecs
              ? dish.dish_specs!.reduce((min, spec) =>
                  Math.min(min, parseFloat(spec.price)), Infinity)
              : parseFloat(dish.price)

            return (
              <Card key={dish.id} className="mb-3">
                <CardContent className="p-3">
                  <View className="flex gap-3">
                    {/* 菜品图片 */}
                    <View className="flex-shrink-0 w-20 h-20 bg-gray-100 rounded-lg overflow-hidden">
                      {dish.image_url ? (
                        <Image src={dish.image_url} mode="aspectFill" className="w-full h-full" />
                      ) : (
                        <View className="w-full h-full flex items-center justify-center">
                          <Text className="text-2xl text-gray-300">🍽</Text>
                        </View>
                      )}
                    </View>

                    {/* 菜品信息 */}
                    <View className="flex-1 min-w-0">
                      <Text className="block text-base font-semibold text-gray-900 truncate">
                        {dish.name}
                      </Text>
                      {dish.description && (
                        <Text className="block text-xs text-gray-500 truncate mt-1">
                          {dish.description}
                        </Text>
                      )}
                      <View className="flex items-baseline mt-1">
                        <Text className="text-lg font-bold text-orange-600">
                          ¥{totalPrice.toFixed(2)}
                        </Text>
                        {hasSpecs && (
                          <Text className="text-xs text-gray-400 ml-1">起</Text>
                        )}
                      </View>

                      {/* 规格 */}
                      {hasSpecs && (
                        <View className="flex flex-wrap gap-1 mt-2">
                          {dish.dish_specs!.map(spec => {
                            const quantity = getCartQuantity(dish.id, spec.id)
                            return (
                              <View key={spec.id} className="flex items-center gap-1">
                                <Badge variant="outline" className="text-xs">
                                  {spec.spec_name}
                                </Badge>
                                <View className="flex items-center gap-1">
                                  <View
                                    className="w-5 h-5 rounded-full bg-orange-100 flex items-center justify-center"
                                    onClick={() => removeFromCart(dish.id, spec.id)}
                                  >
                                    <Minus size={12} color="#f97316" />
                                  </View>
                                  <Text className="text-xs w-6 text-center">{quantity}</Text>
                                  <View
                                    className="w-5 h-5 rounded-full bg-orange-500 flex items-center justify-center"
                                    onClick={() => addToCart(dish, spec)}
                                  >
                                    <Plus size={12} color="#fff" />
                                  </View>
                                </View>
                              </View>
                            )
                          })}
                        </View>
                      )}

                      {/* 无规格时的加减按钮 */}
                      {!hasSpecs && (
                        <View className="flex items-center gap-2 mt-2">
                          <View
                            className="w-6 h-6 rounded-full bg-orange-100 flex items-center justify-center"
                            onClick={() => removeFromCart(dish.id)}
                          >
                            <Minus size={14} color="#f97316" />
                          </View>
                          <Text className="text-sm w-8 text-center">
                            {getCartQuantity(dish.id)}
                          </Text>
                          <View
                            className="w-6 h-6 rounded-full bg-orange-500 flex items-center justify-center"
                            onClick={() => addToCart(dish)}
                          >
                            <Plus size={14} color="#fff" />
                          </View>
                        </View>
                      )}
                    </View>
                  </View>
                </CardContent>
              </Card>
            )
          })
        )}
      </View>

      {/* 底部购物车栏 */}
      {cart.length > 0 && (
        <View
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            padding: '12px 16px',
            backgroundColor: '#fff',
            borderTop: '1px solid #e5e7eb',
            zIndex: 100,
          }}
        >
          <View className="flex-1 flex items-center gap-2">
            <View className="relative">
              <ShoppingCart size={24} color="#f97316" />
              <Badge
                className="absolute -top-2 -right-2 h-4 w-4 p-0 flex items-center justify-center"
                variant="destructive"
              >
                {getTotalQuantity()}
              </Badge>
            </View>
            <View>
              <Text className="block text-xs text-gray-500">合计</Text>
              <Text className="block text-lg font-bold text-orange-600">
                ¥{getTotalPrice().toFixed(2)}
              </Text>
            </View>
          </View>
          <Button
            className="bg-orange-500 hover:bg-orange-600"
            onClick={handleSubmitOrder}
            disabled={submitting}
          >
            {submitting ? (
              <View className="flex items-center">
                <Loader size={16} className="mr-1 animate-spin" color="#ffffff" />
                <Text>提交中...</Text>
              </View>
            ) : (
              <Text>提交订单</Text>
            )}
          </Button>
        </View>
      )}
    </View>
  )
}
