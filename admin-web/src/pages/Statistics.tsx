import { useEffect, useState } from 'react'
import request from '@/api/request'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { Printer } from 'lucide-react'
import { useModal } from '@/components/ModalProvider'

export default function Statistics() {
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [dayData, setDayData] = useState<any[]>([])
  const [categoryData, setCategoryData] = useState<any[]>([])
  const [ranking, setRanking] = useState<any[]>([])
  const [monthData, setMonthData] = useState<any[]>([])
  const { showToast } = useModal()

  const today = new Date().toISOString().slice(0, 10)
  const monthStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const fetchAll = (s?: string, e?: string) => {
    const params = { start_date: s || monthStart, end_date: e || today }
    request.get('/statistics/day', { params }).then((res: any) => setDayData(res || []))
    request.get('/statistics/category', { params }).then((res: any) => setCategoryData(res || []))
    request.get('/statistics/dish-ranking', { params: { ...params, limit: 10 } }).then((res: any) => setRanking(res || []))
    request.get('/statistics/month', { params }).then((res: any) => setMonthData(res || []))
  }

  useEffect(() => {
    fetchAll()
  }, [])

  const handleQuery = () => {
    if (startDate && endDate) fetchAll(startDate, endDate)
  }

  const handlePrintReport = (type: 'day' | 'month') => {
    const data = type === 'day' ? dayData : monthData
    const title = type === 'day' ? '日报' : '月报'
    const totalAmount = data.reduce((sum: number, d: any) => sum + (d.total_amount || 0), 0)
    const totalCount = data.reduce((sum: number, d: any) => sum + (d.order_count || 0), 0)
    const content = `${title}统计\n营业额: ¥${totalAmount.toFixed(2)}\n订单数: ${totalCount}\n统计区间: ${startDate || monthStart} 至 ${endDate || today}`

    request.post('/print/report', { title, content }).then(() => {
      showToast('打印任务已提交', 'success')
    })
  }

  return (
    <div>
      <h2 className="text-2xl font-semibold text-[#0F172A] mb-6">数据统计</h2>

      <div className="flex items-center gap-3 mb-6 bg-white p-4 rounded-xl shadow-sm border border-gray-100">
        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]" />
        <span className="text-[#94A3B8]">至</span>
        <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]" />
        <button onClick={handleQuery} className="px-4 py-2 bg-[#2563EB] text-white rounded-lg text-sm hover:bg-[#1D4ED8] cursor-pointer">查询</button>
        <button onClick={() => handlePrintReport('day')} className="flex items-center gap-1 px-4 py-2 bg-[#10B981] text-white rounded-lg text-sm hover:bg-[#059669] cursor-pointer">
          <Printer size={14} /> 打印日报
        </button>
        <button onClick={() => handlePrintReport('month')} className="flex items-center gap-1 px-4 py-2 bg-[#F59E0B] text-white rounded-lg text-sm hover:bg-[#D97706] cursor-pointer">
          <Printer size={14} /> 打印月报
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold mb-4">日营业额趋势</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={dayData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="total_amount" name="营业额" fill="#2563EB" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold mb-4">月营业额趋势</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={monthData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="total_amount" name="营业额" fill="#10B981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold mb-4">分类销售统计</h3>
          <div className="space-y-3">
            {categoryData.map((c: any) => (
              <div key={c.category_id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                <span className="text-sm">{c.category_name}</span>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-[#94A3B8]">{c.quantity} 份</span>
                  <span className="font-semibold text-[#2563EB]">¥{c.amount.toFixed(2)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold mb-4">菜品销售排行</h3>
          <div className="space-y-3">
            {ranking.map((d: any, i: number) => (
              <div key={d.dish_id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                <div className="flex items-center gap-3">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${i < 3 ? 'bg-[#2563EB] text-white' : 'bg-gray-100 text-gray-500'}`}>{i + 1}</span>
                  <span className="text-sm">{d.dish_name}</span>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-[#94A3B8]">{d.quantity} 份</span>
                  <span className="font-semibold text-[#2563EB]">¥{d.amount.toFixed(2)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
