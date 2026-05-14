import { View, Text } from '@tarojs/components'
import { useState } from 'react'
import Taro from '@tarojs/taro'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Network } from '@/network'
import { Loader } from 'lucide-react-taro'

export default function LoginPage() {
  const [isWeapp] = useState(() => [Taro.ENV_TYPE.WEAPP, Taro.ENV_TYPE.TT].includes(Taro.getEnv() as any))
  const [loading, setLoading] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  // 微信授权登录
  const handleWechatLogin = async () => {
    if (!isWeapp) {
      Taro.showToast({ title: '请在微信小程序中使用', icon: 'none' })
      return
    }

    setLoading(true)
    try {
      // 获取微信登录code
      const { code } = await Taro.login()
      console.log('[微信登录] code:', code)

      // 调用后端接口
      const res = await Network.request({
        url: '/api/auth/wechat-login',
        method: 'POST',
        data: { code }
      })
      console.log('[微信登录] 响应:', res.data)

      if (res.data?.data) {
        const { user, token, isNewUser } = res.data.data
        // 保存用户信息到本地
        Taro.setStorageSync('userInfo', user)
        Taro.setStorageSync('token', token)

        Taro.showToast({
          title: isNewUser ? '欢迎新用户' : '登录成功',
          icon: 'success'
        })

        // 跳转到点餐页（需要扫码进入桌台）
        setTimeout(() => {
          Taro.redirectTo({ url: '/pages/index/index' })
        }, 1500)
      }
    } catch (error: any) {
      console.error('[微信登录] 错误:', error)
      Taro.showToast({ title: error.message || '登录失败', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }

  // 账号密码登录
  const handlePasswordLogin = async () => {
    if (!username || !password) {
      Taro.showToast({ title: '请输入用户名和密码', icon: 'none' })
      return
    }

    setLoading(true)
    try {
      const res = await Network.request({
        url: '/api/auth/login',
        method: 'POST',
        data: { username, password }
      })
      console.log('[账号登录] 响应:', res.data)

      if (res.data?.data) {
        const { user, token } = res.data.data
        Taro.setStorageSync('userInfo', user)
        Taro.setStorageSync('token', token)

        Taro.showToast({ title: '登录成功', icon: 'success' })

        // 根据角色跳转不同页面
        setTimeout(() => {
          if (user.role === 'admin' || user.role === 'staff') {
            // 管理员跳转到后台管理
            Taro.redirectTo({ url: '/pages/admin/index/index' })
          } else {
            // 顾客跳转到首页
            Taro.redirectTo({ url: '/pages/index/index' })
          }
        }, 1500)
      }
    } catch (error: any) {
      console.error('[账号登录] 错误:', error)
      Taro.showToast({ title: error.message || '登录失败', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <View className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 flex flex-col items-center justify-center p-4">
      {/* Logo区域 */}
      <View className="mb-8 text-center">
        <View className="w-20 h-20 bg-orange-500 rounded-full flex items-center justify-center mb-4 mx-auto">
          <Text className="text-white text-3xl font-bold">餐</Text>
        </View>
        <Text className="block text-2xl font-bold text-gray-900 mb-2">桌码点餐</Text>
        <Text className="block text-sm text-gray-500">扫码点餐，便捷用餐</Text>
      </View>

      {/* 微信登录按钮 */}
      {isWeapp && (
        <Card className="w-full max-w-sm mb-4">
          <CardContent className="p-4">
            <Button
              className="w-full bg-green-500 hover:bg-green-600"
              onClick={handleWechatLogin}
              disabled={loading}
            >
              {loading ? (
                <View className="flex items-center justify-center">
                  <Loader size={18} className="mr-2 animate-spin" color="#ffffff" />
                  <Text>登录中...</Text>
                </View>
              ) : (
                <Text>微信一键登录</Text>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* 分隔线 */}
      <View className="flex items-center w-full max-w-sm mb-4">
        <View className="flex-1 h-px bg-gray-300" />
        <Text className="mx-4 text-sm text-gray-400">或</Text>
        <View className="flex-1 h-px bg-gray-300" />
      </View>

      {/* 账号密码登录 */}
      <Card className="w-full max-w-sm">
        <CardContent className="p-4">
          <View className="space-y-3">
            <View className="bg-gray-50 rounded-lg px-4 py-3">
              <Input
                className="w-full bg-transparent"
                placeholder="请输入用户名"
                value={username}
                onInput={(e) => setUsername(e.detail.value)}
              />
            </View>

            <View className="bg-gray-50 rounded-lg px-4 py-3">
              <Input
                className="w-full bg-transparent"
                placeholder="请输入密码"
                password
                value={password}
                onInput={(e) => setPassword(e.detail.value)}
              />
            </View>

            <Button
              className="w-full bg-orange-500 hover:bg-orange-600"
              onClick={handlePasswordLogin}
              disabled={loading}
            >
              {loading ? (
                <View className="flex items-center justify-center">
                  <Loader size={18} className="mr-2 animate-spin" color="#ffffff" />
                  <Text>登录中...</Text>
                </View>
              ) : (
                <Text>账号登录</Text>
              )}
            </Button>
          </View>
        </CardContent>
      </Card>

      {/* 提示文字 */}
      <Text className="block text-xs text-gray-400 mt-8 text-center">
        提示：顾客请扫描桌台二维码进入点餐{'\n'}
        管理员可使用账号密码登录
      </Text>
    </View>
  )
}
