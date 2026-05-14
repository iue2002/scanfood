import { View, Text } from '@tarojs/components'
import { useState, useEffect } from 'react'
import Taro from '@tarojs/taro'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Network } from '@/network'
import { Plus, QrCode, Loader } from 'lucide-react-taro'

interface Table {
  id: number
  table_number: string
  capacity: number
  status: string
  qr_code_url?: string
}

const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  idle: { label: '空闲', variant: 'secondary' },
  occupied: { label: '使用中', variant: 'default' },
  settled: { label: '已结账', variant: 'outline' },
}

export default function TablesPage() {
  const [tables, setTables] = useState<Table[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchTables()
  }, [])

  const fetchTables = async () => {
    try {
      const res = await Network.request({ url: '/api/tables' })
      console.log('[桌台列表]', res.data)
      if (res.data?.data) {
        setTables(res.data.data)
      }
    } catch (error) {
      console.error('获取桌台失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleViewQRCode = (table: Table) => {
    if (table.qr_code_url) {
      Taro.previewImage({
        urls: [table.qr_code_url],
        current: table.qr_code_url
      })
    } else {
      Taro.showToast({ title: '二维码未生成', icon: 'none' })
    }
  }

  const handleAddTable = () => {
    // 简化实现：生成下一个桌台编号
    const nextNumber = tables.length + 1
    const tableNumber = `A${nextNumber}`
    
    Taro.showModal({
      title: '新增桌台',
      content: `确定添加桌台 ${tableNumber}？`,
      success: async (res) => {
        if (res.confirm) {
          try {
            const createRes = await Network.request({
              url: '/api/tables',
              method: 'POST',
              data: {
                table_number: tableNumber,
                capacity: 4
              }
            })
            if (createRes.data?.code === 200) {
              Taro.showToast({ title: '添加成功', icon: 'success' })
              fetchTables()
            }
          } catch (error) {
            Taro.showToast({ title: '添加失败', icon: 'none' })
          }
        }
      }
    })
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
      {/* 顶部操作栏 */}
      <View className="bg-white px-4 py-3 flex justify-between items-center border-b">
        <Text className="text-sm text-gray-500">共 {tables.length} 个桌台</Text>
        <Button size="sm" onClick={handleAddTable}>
          <Plus size={16} className="mr-1" color="#ffffff" />
          <Text>新增</Text>
        </Button>
      </View>

      {/* 桌台列表 */}
      <View className="p-4 grid grid-cols-2 gap-3">
        {tables.map(table => {
          const status = statusMap[table.status] || statusMap.idle
          return (
            <Card key={table.id} className="shadow-sm">
              <CardContent className="p-3">
                <View className="flex justify-between items-start mb-2">
                  <Text className="text-xl font-bold text-gray-900">{table.table_number}</Text>
                  <Badge variant={status.variant}>{status.label}</Badge>
                </View>
                <View className="flex justify-between items-center mt-3">
                  <Text className="text-xs text-gray-500">{table.capacity}人桌</Text>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleViewQRCode(table)}
                  >
                    <QrCode size={14} className="mr-1" color="#6b7280" />
                    <Text className="text-xs">二维码</Text>
                  </Button>
                </View>
              </CardContent>
            </Card>
          )
        })}
      </View>

      {tables.length === 0 && (
        <View className="text-center py-12">
          <Text className="block text-gray-400">暂无桌台数据</Text>
          <Button className="mt-4" onClick={handleAddTable}>添加第一个桌台</Button>
        </View>
      )}
    </View>
  )
}
