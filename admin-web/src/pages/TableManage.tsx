import { useEffect, useState } from 'react'
import request from '@/api/request'
import { Plus, QrCode, Trash2, Edit2 } from 'lucide-react'
import { useModal } from '@/components/ModalProvider'

// 获取服务器基础地址
const getServerBaseURL = () => {
  return import.meta.env.VITE_API_BASE_URL?.replace('/api', '') || 'http://localhost:3000'
}

interface Table {
  id: number
  table_number: string
  capacity: number
  status: 'idle' | 'occupied' | 'settled'
  qr_code_url: string | null
}

const statusMap: Record<string, { label: string; color: string }> = {
  idle: { label: '空闲', color: 'text-[#10B981] bg-[#D1FAE5]' },
  occupied: { label: '已占用', color: 'text-[#F59E0B] bg-[#FEF3C7]' },
  settled: { label: '已结账', color: 'text-[#94A3B8] bg-[#F1F5F9]' },
}

export default function TableManage() {
  const [tables, setTables] = useState<Table[]>([])
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Table | null>(null)
  const [form, setForm] = useState({ table_number: '', capacity: 4 })
  const { showToast, showConfirm } = useModal()

  const fetchTables = () => {
    request.get('/tables').then((res: any) => setTables(res || []))
  }

  useEffect(() => {
    fetchTables()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.table_number.trim() || !form.capacity) {
      showToast('请填写完整信息', 'warning')
      return
    }

    try {
      if (editing) {
        await request.put(`/tables/${editing.id}`, form)
        showToast('桌台更新成功！', 'success')
      } else {
        await request.post('/tables', form)
        showToast('桌台创建成功！', 'success')
      }
      setShowModal(false)
      setEditing(null)
      setForm({ table_number: '', capacity: 4 })
      fetchTables()
    } catch (error: any) {
      console.error('保存桌台失败:', error)
      if (error.response?.data?.message) {
        showToast(error.response.data.message, 'error')
      } else {
        showToast('保存失败，请重试', 'error')
      }
    }
  }

  const handleDelete = async (id: number) => {
    const table = tables.find(t => t.id === id)
    showConfirm('确认删除', table ? `确定要删除桌台「${table.table_number}」吗？` : '确定删除该桌台吗？', async () => {
      try {
        await request.delete(`/tables/${id}`)
        await fetchTables()
        showToast('删除成功！', 'success')
      } catch (error) {
        console.error('删除桌台失败:', error)
        showToast('删除失败，请重试', 'error')
      }
    })
  }

  const handleGenerateQr = async (id: number) => {
    await request.post(`/tables/${id}/qrcode`)
    fetchTables()
  }

  const handleSetStatus = async (id: number, status: 'idle' | 'occupied' | 'settled') => {
    await request.post(`/tables/${id}/status`, { status })
    fetchTables()
  }

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
          <h2 className="text-2xl font-semibold text-[#0F172A]">桌台管理</h2>
          <button
            onClick={() => { setEditing(null); setForm({ table_number: '', capacity: 4 }); setShowModal(true) }}
            className="inline-flex w-fit shrink-0 items-center gap-2 px-4 py-2 bg-[#2563EB] text-white rounded-lg text-sm font-medium hover:bg-[#1D4ED8] transition-colors cursor-pointer"
          >
            <Plus size={16} />
            新增桌台
          </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {tables.map((table) => {
          const status = statusMap[table.status]
          return (
            <div key={table.id} className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xl font-bold text-[#0F172A]">{table.table_number}</span>
                <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${status.color}`}>{status.label}</span>
              </div>
              <p className="text-sm text-[#94A3B8] mb-4">容纳 {table.capacity} 人</p>
              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={() => handleGenerateQr(table.id)} className="p-3 text-[#2563EB] hover:bg-[#EFF6FF] rounded-lg transition-colors cursor-pointer active:bg-[#DBEAFE]" title="生成二维码">
                  <QrCode size={18} />
                </button>
                <button onClick={() => handleSetStatus(table.id, 'idle')} className="px-3 py-2 text-sm text-[#10B981] hover:bg-[#D1FAE5] rounded-lg transition-colors cursor-pointer active:bg-[#A7F3D0]">置为空闲</button>
                <button onClick={() => handleSetStatus(table.id, 'occupied')} className="px-3 py-2 text-sm text-[#F59E0B] hover:bg-[#FEF3C7] rounded-lg transition-colors cursor-pointer active:bg-[#FDE68A]">置为占用</button>
                <button onClick={() => { setEditing(table); setForm({ table_number: table.table_number, capacity: table.capacity }); setShowModal(true) }} className="p-3 text-[#6366F1] hover:bg-[#EEF2FF] rounded-lg transition-colors cursor-pointer active:bg-[#E0E7FF]">
                  <Edit2 size={18} />
                </button>
                <button onClick={() => handleDelete(table.id)} className="p-3 text-[#EF4444] hover:bg-red-50 rounded-lg transition-colors cursor-pointer active:bg-red-100">
                  <Trash2 size={18} />
                </button>
              </div>
              {table.qr_code_url && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <img 
                    src={
                      table.qr_code_url.startsWith('http') 
                        ? table.qr_code_url 
                        : getServerBaseURL() + table.qr_code_url
                    } 
                    alt="二维码" 
                    className="w-24 h-24 mx-auto" 
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
            <h3 className="text-lg font-semibold mb-4">{editing ? '编辑桌台' : '新增桌台'}</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-[#334155] mb-1">桌台编号</label>
                <input value={form.table_number} onChange={e => setForm({ ...form, table_number: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]" placeholder="如 A1" />
              </div>
              <div>
                <label className="block text-sm text-[#334155] mb-1">容纳人数</label>
                <input type="number" value={form.capacity} onChange={e => setForm({ ...form, capacity: parseInt(e.target.value) || 1 })} className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 py-2 border rounded-lg text-sm hover:bg-gray-50 cursor-pointer">取消</button>
                <button type="submit" className="flex-1 py-2 bg-[#2563EB] text-white rounded-lg text-sm hover:bg-[#1D4ED8] cursor-pointer">保存</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
