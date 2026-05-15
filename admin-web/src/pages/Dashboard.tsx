import { useEffect, useState } from 'react'
import request from '@/api/request'
import { DollarSign, ShoppingCart, TrendingUp, Users } from 'lucide-react'

interface Overview {
  today_amount: string
  today_count: number
  total_orders: number
  total_amount: string
}

export default function Dashboard() {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    request.get('/statistics/overview').then((res: any) => {
      setOverview(res)
      setLoading(false)
    })
  }, [])

  const cards = [
    { label: '今日营业额', value: `¥${overview?.today_amount || '0.00'}`, icon: DollarSign, color: 'bg-[#2563EB]' },
    { label: '今日订单数', value: overview?.today_count || 0, icon: ShoppingCart, color: 'bg-[#10B981]' },
    { label: '总订单数', value: overview?.total_orders || 0, icon: Users, color: 'bg-[#6366F1]' },
    { label: '总营业额', value: `¥${overview?.total_amount || '0.00'}`, icon: TrendingUp, color: 'bg-[#F59E0B]' },
  ]

  return (
    <div>
      <h2 className="text-2xl font-semibold text-[#0F172A] mb-6">数据总览</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {cards.map((card) => {
          const Icon = card.icon
          return (
            <div key={card.label} className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-[#94A3B8] mb-1">{card.label}</p>
                  <p className="text-2xl font-bold text-[#0F172A]">{loading ? '-' : card.value}</p>
                </div>
                <div className={`w-12 h-12 ${card.color} rounded-xl flex items-center justify-center`}>
                  <Icon size={24} className="text-white" />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
        <h3 className="text-lg font-semibold text-[#0F172A] mb-4">欢迎使用</h3>
        <p className="text-sm text-[#334155] leading-relaxed">
          扫码点餐管理系统帮助您高效管理餐厅运营。通过左侧菜单可以管理桌台、订单、菜品，查看数据统计和处理退款售后。
        </p>
      </div>
    </div>
  )
}
