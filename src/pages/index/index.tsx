import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Card, CardContent } from '@/components/ui/card'
import { ScanLine, User, ShoppingBag } from 'lucide-react-taro'

export default function Index() {
  const handleScanQRCode = () => {
    // 检查是否在小程序环境
    if (!([Taro.ENV_TYPE.WEAPP, Taro.ENV_TYPE.TT].includes(Taro.getEnv() as any))) {
      // H5环境提示
      Taro.showToast({
        title: '请在微信小程序中扫码',
        icon: 'none',
        duration: 2000
      })
      return
    }

    Taro.scanCode({
      success: (res) => {
        console.log('[扫码结果]', res)
        // 解析二维码内容，提取桌台编号
        // 假设二维码格式为: https://your-domain.com/order?table=A1&table_id=1
        const result = res.result
        const urlMatch = result.match(/table=([^&]+).*table_id=(\d+)/)

        if (urlMatch) {
          const tableNumber = urlMatch[1]
          const tableId = urlMatch[2]

          // 跳转到点餐页
          Taro.navigateTo({
            url: `/pages/order/index?table_id=${tableId}&table_number=${tableNumber}`
          })
        } else {
          Taro.showToast({
            title: '无效的桌台二维码',
            icon: 'none'
          })
        }
      },
      fail: (err) => {
        console.error('[扫码失败]', err)
        Taro.showToast({
          title: '扫码失败',
          icon: 'none'
        })
      }
    })
  }

  const handleGoToLogin = () => {
    Taro.navigateTo({ url: '/pages/login/index' })
  }

  const handleGoToAdmin = () => {
    const userInfo = Taro.getStorageSync('userInfo')
    if (userInfo && (userInfo.role === 'admin' || userInfo.role === 'staff')) {
      Taro.switchTab({ url: '/pages/admin/index/index' })
    } else {
      Taro.navigateTo({ url: '/pages/login/index' })
    }
  }

  return (
    <View className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50">
      {/* 顶部欢迎区 */}
      <View className="px-4 pt-12 pb-8 text-center">
        <View className="w-24 h-24 bg-orange-500 rounded-full flex items-center justify-center mb-4 mx-auto shadow-lg">
          <Text className="text-white text-4xl font-bold">餐</Text>
        </View>
        <Text className="block text-3xl font-bold text-gray-900 mb-2">桌码点餐</Text>
        <Text className="block text-base text-gray-500">扫码点餐，便捷用餐</Text>
      </View>

      {/* 主要功能区 */}
      <View className="px-4 space-y-3">
        {/* 扫码点餐卡片 */}
        <Card className="shadow-md">
          <CardContent className="p-6">
            <View className="flex items-center gap-4" onClick={handleScanQRCode}>
              <View className="w-14 h-14 bg-orange-100 rounded-2xl flex items-center justify-center">
                <ScanLine size={28} color="#f97316" />
              </View>
              <View className="flex-1">
                <Text className="block text-lg font-semibold text-gray-900">扫码点餐</Text>
                <Text className="block text-sm text-gray-500 mt-1">扫描桌上二维码开始点餐</Text>
              </View>
              <Text className="text-orange-500 text-lg">→</Text>
            </View>
          </CardContent>
        </Card>

        {/* 管理员登录卡片 */}
        <Card className="shadow-md">
          <CardContent className="p-6">
            <View className="flex items-center gap-4" onClick={handleGoToLogin}>
              <View className="w-14 h-14 bg-blue-100 rounded-2xl flex items-center justify-center">
                <User size={28} color="#3b82f6" />
              </View>
              <View className="flex-1">
                <Text className="block text-lg font-semibold text-gray-900">账号登录</Text>
                <Text className="block text-sm text-gray-500 mt-1">管理员或前台登录</Text>
              </View>
              <Text className="text-blue-500 text-lg">→</Text>
            </View>
          </CardContent>
        </Card>

        {/* 后台管理卡片 */}
        <Card className="shadow-md">
          <CardContent className="p-6">
            <View className="flex items-center gap-4" onClick={handleGoToAdmin}>
              <View className="w-14 h-14 bg-purple-100 rounded-2xl flex items-center justify-center">
                <ShoppingBag size={28} color="#9333ea" />
              </View>
              <View className="flex-1">
                <Text className="block text-lg font-semibold text-gray-900">后台管理</Text>
                <Text className="block text-sm text-gray-500 mt-1">管理桌台、订单、菜品</Text>
              </View>
              <Text className="text-purple-500 text-lg">→</Text>
            </View>
          </CardContent>
        </Card>
      </View>

      {/* 底部提示 */}
      <View className="px-4 mt-8 text-center">
        <Text className="block text-xs text-gray-400">
          使用说明：{'\n'}
          顾客请扫描桌台二维码开始点餐{'\n'}
          管理员可通过账号密码登录后台管理
        </Text>
      </View>
    </View>
  )
}
