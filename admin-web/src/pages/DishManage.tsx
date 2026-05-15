import { useEffect, useState, useRef } from 'react'
import request from '@/api/request'
import { Plus, Trash2, Edit2, ToggleLeft, ToggleRight, Camera, X, FolderOpen } from 'lucide-react'

interface Category {
  id: number
  name: string
}

interface Dish {
  id: number
  category_id: number
  name: string
  price: string
  image_url?: string
  status: 'available' | 'unavailable'
  dish_specs?: Array<{ id: number; spec_name: string; price: string }>
}

const API_BASE = 'http://localhost:3000'

export default function DishManage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [dishes, setDishes] = useState<Dish[]>([])
  const [activeCategory, setActiveCategory] = useState<number | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Dish | null>(null)
  const [form, setForm] = useState({ name: '', price: '', category_id: 0, image_url: '' })

  const [showCatModal, setShowCatModal] = useState(false)
  const [catForm, setCatForm] = useState({ name: '' })
  const [uploading, setUploading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchData = () => {
    request.get('/dishes/categories').then((res: any) => setCategories(res || []))
    request.get('/dishes').then((res: any) => setDishes(res || []))
  }

  useEffect(() => {
    fetchData()
  }, [])

  const filtered = activeCategory ? dishes.filter(d => d.category_id === activeCategory) : dishes

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const data = { ...form, price: parseFloat(form.price) }
    if (editing) {
      await request.put(`/dishes/${editing.id}`, data)
    } else {
      await request.post('/dishes', data)
    }
    setShowModal(false)
    setEditing(null)
    setForm({ name: '', price: '', category_id: categories[0]?.id || 0, image_url: '' })
    setPreviewUrl('')
    fetchData()
  }

  const handleToggle = async (id: number) => {
    await request.post(`/dishes/${id}/toggle`)
    fetchData()
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除该菜品吗？')) return
    await request.delete(`/dishes/${id}`)
    fetchData()
  }

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!catForm.name.trim()) return
    await request.post('/dishes/categories', { name: catForm.name.trim() })
    setCatForm({ name: '' })
    setShowCatModal(false)
    fetchData()
  }

  const handleDeleteCategory = async (id: number, name: string) => {
    const count = dishes.filter(d => d.category_id === id).length
    const msg = count > 0
      ? `分类「${name}」下还有 ${count} 个菜品，删除后这些菜品将无法正常显示，确定删除吗？`
      : `确定删除分类「${name}」吗？`
    if (!confirm(msg)) return
    await request.delete(`/dishes/categories/${id}`)
    if (activeCategory === id) setActiveCategory(null)
    fetchData()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res: any = await request.post('/upload/image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const url = res?.url ? `${API_BASE}${res.url}` : ''
      setForm(prev => ({ ...prev, image_url: url }))
      setPreviewUrl(url)
    } catch (err: any) {
      alert('图片上传失败：' + (err?.message || '未知错误'))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const openFilePicker = (capture?: string) => {
    if (!fileInputRef.current) return
    if (capture) {
      fileInputRef.current.setAttribute('capture', capture)
    } else {
      fileInputRef.current.removeAttribute('capture')
    }
    fileInputRef.current.click()
  }

  const openAddModal = () => {
    setEditing(null)
    setForm({ name: '', price: '', category_id: categories[0]?.id || 0, image_url: '' })
    setPreviewUrl('')
    setShowModal(true)
  }

  const openEditModal = (dish: Dish) => {
    setEditing(dish)
    const img = dish.image_url || ''
    setForm({ name: dish.name, price: dish.price, category_id: dish.category_id, image_url: img })
    setPreviewUrl(img)
    setShowModal(true)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold text-[#0F172A]">菜品管理</h2>
        <button
          onClick={openAddModal}
          className="flex items-center gap-2 px-4 py-2 bg-[#2563EB] text-white rounded-lg text-sm font-medium hover:bg-[#1D4ED8] transition-colors cursor-pointer"
        >
          <Plus size={16} />
          新增菜品
        </button>
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button onClick={() => setActiveCategory(null)} className={`px-3 py-1.5 rounded-lg text-sm transition-colors cursor-pointer ${activeCategory === null ? 'bg-[#2563EB] text-white' : 'bg-white text-[#334155] hover:bg-gray-50'}`}>全部</button>
        {categories.map(cat => (
          <div key={cat.id} className="flex items-center gap-1">
            <button onClick={() => setActiveCategory(cat.id)} className={`px-3 py-1.5 rounded-lg text-sm transition-colors cursor-pointer ${activeCategory === cat.id ? 'bg-[#2563EB] text-white' : 'bg-white text-[#334155] hover:bg-gray-50'}`}>
              {cat.name}
            </button>
            <button onClick={() => handleDeleteCategory(cat.id, cat.name)} className="p-1 text-gray-400 hover:text-red-500 transition-colors cursor-pointer" title="删除分类">
              <X size={14} />
            </button>
          </div>
        ))}
        <button onClick={() => { setCatForm({ name: '' }); setShowCatModal(true) }} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm bg-white text-[#2563EB] border border-[#2563EB] hover:bg-[#EFF6FF] transition-colors cursor-pointer">
          <Plus size={14} />
          新建分类
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#F8FAFC] text-[#334155]">
            <tr>
              <th className="text-left px-4 py-3 font-medium">菜品</th>
              <th className="text-left px-4 py-3 font-medium">分类</th>
              <th className="text-left px-4 py-3 font-medium">价格</th>
              <th className="text-left px-4 py-3 font-medium">规格</th>
              <th className="text-left px-4 py-3 font-medium">状态</th>
              <th className="text-left px-4 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((dish) => (
              <tr key={dish.id} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gray-100 rounded-lg overflow-hidden shrink-0">
                      {dish.image_url ? <img src={dish.image_url} className="w-full h-full object-cover" alt="" /> : <div className="w-full h-full flex items-center justify-center text-gray-300 text-xs">无图</div>}
                    </div>
                    <span className="font-medium">{dish.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3">{categories.find(c => c.id === dish.category_id)?.name || '-'}</td>
                <td className="px-4 py-3 font-semibold">¥{dish.price}</td>
                <td className="px-4 py-3">
                  {dish.dish_specs?.map(s => `${s.spec_name} ¥${s.price}`).join(', ') || '-'}
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-medium px-2 py-1 rounded-full ${dish.status === 'available' ? 'text-[#10B981] bg-[#D1FAE5]' : 'text-[#94A3B8] bg-[#F1F5F9]'}`}>
                    {dish.status === 'available' ? '上架' : '下架'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <button onClick={() => handleToggle(dish.id)} className="p-3 text-[#2563EB] hover:bg-[#EFF6FF] rounded-lg transition-colors cursor-pointer active:bg-[#DBEAFE]" title="上下架">
                      {dish.status === 'available' ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                    </button>
                    <button onClick={() => openEditModal(dish)} className="p-3 text-[#6366F1] hover:bg-[#EEF2FF] rounded-lg transition-colors cursor-pointer active:bg-[#E0E7FF]">
                      <Edit2 size={20} />
                    </button>
                    <button onClick={() => handleDelete(dish.id)} className="p-3 text-[#EF4444] hover:bg-red-50 rounded-lg transition-colors cursor-pointer active:bg-red-100">
                      <Trash2 size={20} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 菜品弹窗 */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">{editing ? '编辑菜品' : '新增菜品'}</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-[#334155] mb-1">菜品名称</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]" required />
              </div>
              <div>
                <label className="block text-sm text-[#334155] mb-1">分类</label>
                <select value={form.category_id} onChange={e => setForm({ ...form, category_id: parseInt(e.target.value) })} className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]">
                  {categories.length === 0 && <option value={0}>暂无分类，请先新建分类</option>}
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm text-[#334155] mb-1">价格</label>
                <input type="number" step="0.01" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]" required />
              </div>
              <div>
                <label className="block text-sm text-[#334155] mb-1">图片</label>
                <input type="file" accept="image/*" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
                <div className="flex gap-2 mb-2">
                  <button type="button" onClick={() => openFilePicker()} className="flex items-center gap-1 px-3 py-2 border rounded-lg text-sm hover:bg-gray-50 cursor-pointer">
                    <FolderOpen size={14} />
                    选择图片
                  </button>
                  <button type="button" onClick={() => openFilePicker('environment')} className="flex items-center gap-1 px-3 py-2 border rounded-lg text-sm hover:bg-gray-50 cursor-pointer md:hidden">
                    <Camera size={14} />
                    拍照
                  </button>
                </div>
                {uploading && <div className="text-sm text-gray-500">上传中...</div>}
                {previewUrl && !uploading && (
                  <div className="relative w-24 h-24 rounded-lg overflow-hidden border">
                    <img src={previewUrl} className="w-full h-full object-cover" alt="preview" />
                    <button type="button" onClick={() => { setForm(prev => ({ ...prev, image_url: '' })); setPreviewUrl('') }} className="absolute top-0.5 right-0.5 p-0.5 bg-black/50 text-white rounded-full cursor-pointer">
                      <X size={12} />
                    </button>
                  </div>
                )}
                {!previewUrl && !uploading && <div className="text-xs text-gray-400">支持 JPG、PNG、GIF，最大 5MB</div>}
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 py-2 border rounded-lg text-sm hover:bg-gray-50 cursor-pointer">取消</button>
                <button type="submit" className="flex-1 py-2 bg-[#2563EB] text-white rounded-lg text-sm hover:bg-[#1D4ED8] cursor-pointer">保存</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 新建分类弹窗 */}
      {showCatModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-lg font-semibold mb-4">新建菜品分类</h3>
            <form onSubmit={handleCreateCategory} className="space-y-4">
              <div>
                <label className="block text-sm text-[#334155] mb-1">分类名称</label>
                <input value={catForm.name} onChange={e => setCatForm({ name: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]" placeholder="例如：热菜、凉菜、饮品" required />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowCatModal(false)} className="flex-1 py-2 border rounded-lg text-sm hover:bg-gray-50 cursor-pointer">取消</button>
                <button type="submit" className="flex-1 py-2 bg-[#2563EB] text-white rounded-lg text-sm hover:bg-[#1D4ED8] cursor-pointer">保存</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
