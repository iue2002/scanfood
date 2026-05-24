import { useEffect, useState, useRef } from 'react'
import request from '@/api/request'
import { Plus, Trash2, Edit2, ToggleLeft, ToggleRight, Camera, X, FolderOpen, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import { useModal } from '@/components/ModalProvider'

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
  is_required?: boolean
  min_quantity?: number
  dish_specs?: Array<{ id: number; spec_name: string; price: string }>
}

interface CompressionResult {
  success: boolean
  data?: {
    url: string
    originalSize: number
    compressedSize: number
    compressionRatio: number
  }
  message?: string
  allowOriginalUpload?: boolean
}

const API_BASE = import.meta.env.VITE_API_BASE_URL?.replace('/api', '') || 'http://localhost:3000'

export default function DishManage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [dishes, setDishes] = useState<Dish[]>([])
  const [activeCategory, setActiveCategory] = useState<number | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Dish | null>(null)
  const [form, setForm] = useState({ name: '', price: '', category_id: 0, image_url: '', is_required: false, min_quantity: 1 })
  const { showToast, showConfirm } = useModal()

  const [showCatModal, setShowCatModal] = useState(false)
  const [catForm, setCatForm] = useState({ name: '' })
  const [uploading, setUploading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState('')
  const [compressing, setCompressing] = useState(false)
  const [compressionProgress, setCompressionProgress] = useState(0)
  const [compressionResult, setCompressionResult] = useState<CompressionResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchData = () => {
    request.get('/dishes/categories').then((res: any) => setCategories(res || []))
    request.get('/dishes', { params: { include_unavailable: true } }).then((res: any) => setDishes(res || []))
  }

  useEffect(() => {
    fetchData()
  }, [])

  const filtered = activeCategory ? dishes.filter(d => d.category_id === activeCategory) : dishes

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const data = {
      ...form,
      price: parseFloat(form.price),
      min_quantity: Math.max(1, Number(form.min_quantity) || 1),
    }
    if (editing) {
      await request.put(`/dishes/${editing.id}`, data)
    } else {
      await request.post('/dishes', data)
    }
    setShowModal(false)
    setEditing(null)
    setForm({ name: '', price: '', category_id: categories[0]?.id || 0, image_url: '', is_required: false, min_quantity: 1 })
    setPreviewUrl('')
    setCompressionResult(null)
    fetchData()
  }

  const handleToggle = async (id: number) => {
    await request.post(`/dishes/${id}/toggle`)
    fetchData()
  }

  const handleDelete = async (id: number) => {
    showConfirm('确认删除', '确定删除该菜品吗？', async () => {
      await request.delete(`/dishes/${id}`)
      fetchData()
      showToast('菜品删除成功', 'success')
    })
  }

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!catForm.name.trim()) return
    await request.post('/dishes/categories', { name: catForm.name.trim() })
    setCatForm({ name: '' })
    setShowCatModal(false)
    fetchData()
    showToast('分类创建成功', 'success')
  }

  const handleDeleteCategory = async (id: number, name: string) => {
    const count = dishes.filter(d => d.category_id === id).length
    const msg = count > 0
      ? `分类「${name}」下还有 ${count} 个菜品，删除后这些菜品将无法正常显示，确定删除吗？`
      : `确定删除分类「${name}」吗？`
    showConfirm('确认删除', msg, async () => {
      await request.delete(`/dishes/categories/${id}`)
      if (activeCategory === id) setActiveCategory(null)
      fetchData()
      showToast('分类删除成功', 'success')
    })
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
  }

  const uploadOriginalImage = async (file: File) => {
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
      showToast('图片上传成功', 'success')
    } catch (err: any) {
      showToast('图片上传失败：' + (err?.message || '未知错误'), 'error')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    setCompressing(true)
    setCompressionProgress(0)
    setCompressionResult(null)
    setPreviewUrl('')

    const progressInterval = setInterval(() => {
      setCompressionProgress(prev => {
        if (prev >= 90) return 90
        return prev + Math.random() * 15
      })
    }, 300)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res: CompressionResult = await request.post('/upload/compress', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })

      clearInterval(progressInterval)
      setCompressionProgress(100)

      if (res.success && res.data) {
        setCompressionResult(res)
        const url = `${API_BASE}${res.data.url}`
        setForm(prev => ({ ...prev, image_url: url }))
        setPreviewUrl(url)
        const savedSize = res.data.originalSize - res.data.compressedSize
        showToast(`图片压缩成功！节省 ${formatFileSize(savedSize)}（${res.data.compressionRatio}%）`, 'success')
      } else {
        setCompressionResult(res)
        showConfirm(
          '压缩失败',
          `${res.message || '图片压缩失败'}\n\n图片大小：${formatFileSize(file.size)}\n\n是否继续上传原图？`,
          () => {
            uploadOriginalImage(file)
          },
          () => {
            if (fileInputRef.current) fileInputRef.current.value = ''
          }
        )
      }
    } catch (err: any) {
      clearInterval(progressInterval)
      setCompressionResult({
        success: false,
        message: err?.message || '图片压缩请求失败',
        allowOriginalUpload: true,
      })
      showConfirm(
        '压缩失败',
        `${err?.message || '图片压缩请求失败'}\n\n图片大小：${formatFileSize(file.size)}\n\n是否继续上传原图？`,
        () => {
          uploadOriginalImage(file)
        },
        () => {
          if (fileInputRef.current) fileInputRef.current.value = ''
        }
      )
    } finally {
      setCompressing(false)
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
    setForm({ name: '', price: '', category_id: categories[0]?.id || 0, image_url: '', is_required: false, min_quantity: 1 })
    setPreviewUrl('')
    setCompressionResult(null)
    setShowModal(true)
  }

  const openEditModal = (dish: Dish) => {
    setEditing(dish)
    const img = dish.image_url || ''
    setForm({
      name: dish.name,
      price: dish.price,
      category_id: dish.category_id,
      image_url: img,
      is_required: !!dish.is_required,
      min_quantity: dish.min_quantity ?? 1,
    })
    setPreviewUrl(img)
    setCompressionResult(null)
    setShowModal(true)
  }

  const resetImage = () => {
    setForm(prev => ({ ...prev, image_url: '' }))
    setPreviewUrl('')
    setCompressionResult(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
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
        {/* 桌面端：表格视图（≥ md） */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
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
                      {dish.image_url ? 
                        <img 
                          src={dish.image_url.startsWith('http') ? dish.image_url : API_BASE + dish.image_url} 
                          className="w-full h-full object-cover" 
                          alt="" 
                        /> : 
                        <div className="w-full h-full flex items-center justify-center text-gray-300 text-xs">无图</div>
                      }
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">{dish.name}</span>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {dish.is_required && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-[#FEE2E2] text-[#B91C1C] font-medium">必选</span>
                        )}
                        {dish.min_quantity && dish.min_quantity > 1 && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-[#FEF3C7] text-[#92400E]">≥ {dish.min_quantity} 份</span>
                        )}
                      </div>
                    </div>
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

        {/* 手机/小平板：卡片视图（仿顾客小程序菜品卡片，左大图 + 右信息） */}
        <div className="md:hidden divide-y divide-gray-100">
          {filtered.length === 0 && (
            <div className="text-center py-16 text-[#94A3B8]">暂无菜品</div>
          )}
          {filtered.map((dish) => {
            const categoryName = categories.find(c => c.id === dish.category_id)?.name || '-'
            const isAvailable = dish.status === 'available'
            return (
              <div key={dish.id} className="p-3 hover:bg-gray-50/50 transition-colors">
                <div className="flex gap-3">
                  {/* 左：大图 */}
                  <div className="w-24 h-24 bg-gray-100 rounded-xl overflow-hidden shrink-0">
                    {dish.image_url ? (
                      <img
                        src={dish.image_url.startsWith('http') ? dish.image_url : API_BASE + dish.image_url}
                        className="w-full h-full object-cover"
                        alt=""
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-300 text-xs">无图</div>
                    )}
                  </div>

                  {/* 右：信息 + 操作 */}
                  <div className="flex-1 min-w-0 flex flex-col">
                    {/* 第一行：名称 + 状态徽章 */}
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h3 className="text-base font-semibold text-[#0F172A] truncate">{dish.name}</h3>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${isAvailable ? 'text-[#10B981] bg-[#D1FAE5]' : 'text-[#94A3B8] bg-[#F1F5F9]'}`}>
                        {isAvailable ? '上架' : '下架'}
                      </span>
                    </div>

                    {/* 第二行：分类 + 必选/最少数量徽章 */}
                    <div className="flex items-center gap-1.5 flex-wrap mb-1">
                      <span className="text-xs text-[#64748B]">{categoryName}</span>
                      {dish.is_required && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-[#FEE2E2] text-[#B91C1C] font-medium">必选</span>
                      )}
                      {dish.min_quantity && dish.min_quantity > 1 && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-[#FEF3C7] text-[#92400E]">≥ {dish.min_quantity} 份</span>
                      )}
                    </div>

                    {/* 第三行：规格（如有） */}
                    {dish.dish_specs && dish.dish_specs.length > 0 && (
                      <div className="text-xs text-[#94A3B8] mb-1.5 truncate">
                        {dish.dish_specs.map(s => `${s.spec_name} ¥${s.price}`).join(' / ')}
                      </div>
                    )}

                    {/* 底部：价格 + 操作按钮（push 到底部） */}
                    <div className="mt-auto flex items-end justify-between gap-2">
                      <div className="flex items-baseline">
                        <span className="text-sm text-[#EF4444]">¥</span>
                        <span className="text-xl font-bold text-[#EF4444] leading-none">{dish.price}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleToggle(dish.id)}
                          className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-[#2563EB] bg-[#EFF6FF] active:bg-[#DBEAFE] transition-colors cursor-pointer"
                          title={isAvailable ? '点击下架' : '点击上架'}
                        >
                          {isAvailable ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                        </button>
                        <button
                          onClick={() => openEditModal(dish)}
                          className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-[#6366F1] bg-[#EEF2FF] active:bg-[#E0E7FF] transition-colors cursor-pointer"
                          title="编辑"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(dish.id)}
                          className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-[#EF4444] bg-red-50 active:bg-red-100 transition-colors cursor-pointer"
                          title="删除"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
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

              {/* 必选 + 最少数量（订单提交时校验，加菜不受限） */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-[#F8FAFC] rounded-lg border border-gray-100">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.is_required}
                    onChange={(e) => setForm({ ...form, is_required: e.target.checked })}
                    className="w-4 h-4 rounded border-gray-300 text-[#2563EB] focus:ring-[#2563EB]"
                  />
                  <div>
                    <div className="text-sm text-[#334155]">必选菜品</div>
                    <div className="text-xs text-[#94A3B8]">顾客下单未点会被拒</div>
                  </div>
                </label>
                <div>
                  <label className="text-sm text-[#334155]">最少点餐数量</label>
                  <input
                    type="number"
                    min={1}
                    max={999}
                    step={1}
                    value={form.min_quantity}
                    onChange={(e) => setForm({ ...form, min_quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                    className="mt-1 w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                  />
                  <div className="text-xs text-[#94A3B8] mt-1">选了该菜则数量需 ≥ 此值</div>
                </div>
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

                {(compressing || compressionResult) && (
                  <div className="mb-2">
                    {compressing && (
                      <div className="flex flex-col items-center">
                        <div className="flex items-center gap-2 mb-2">
                          <Loader2 size={16} className="animate-spin text-[#2563EB]" />
                          <span className="text-sm text-gray-600">图片压缩中...</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div 
                            className="bg-[#2563EB] h-2 rounded-full transition-all duration-300"
                            style={{ width: `${compressionProgress}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-500 mt-1">{Math.round(compressionProgress)}%</span>
                      </div>
                    )}
                    
                    {compressionResult && !compressing && (
                      <div className={`flex items-center gap-2 p-2 rounded-lg ${compressionResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                        {compressionResult.success ? (
                          <>
                            <CheckCircle size={16} />
                            <span className="text-sm">
                              压缩成功！压缩率 {compressionResult.data?.compressionRatio}%
                              {compressionResult.data && (
                                <span className="ml-1">
                                  ({formatFileSize(compressionResult.data.originalSize)} → {formatFileSize(compressionResult.data.compressedSize)})
                                </span>
                              )}
                            </span>
                          </>
                        ) : (
                          <>
                            <AlertCircle size={16} />
                            <span className="text-sm">{compressionResult.message}</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {previewUrl && !compressing && (
                  <div className="relative w-24 h-24 rounded-lg overflow-hidden border">
                    <img src={previewUrl} className="w-full h-full object-cover" alt="preview" />
                    <button type="button" onClick={resetImage} className="absolute top-0.5 right-0.5 p-0.5 bg-black/50 text-white rounded-full cursor-pointer">
                      <X size={12} />
                    </button>
                  </div>
                )}

                {!previewUrl && !compressing && !compressionResult && (
                  <div className="text-xs text-gray-400">支持 JPG、PNG、GIF，最大 5MB</div>
                )}

                {!previewUrl && !compressing && compressionResult && !compressionResult.success && (
                  <div className="flex gap-2">
                    <button 
                      type="button" 
                      onClick={() => {
                        const file = (fileInputRef.current?.files?.[0])
                        if (file) {
                          uploadOriginalImage(file)
                        }
                      }}
                      className="px-3 py-1.5 border border-[#2563EB] text-[#2563EB] rounded-lg text-sm hover:bg-[#EFF6FF] cursor-pointer"
                    >
                      上传原图
                    </button>
                    <button type="button" onClick={resetImage} className="px-3 py-1.5 border rounded-lg text-sm hover:bg-gray-50 cursor-pointer">
                      取消
                    </button>
                  </div>
                )}
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowModal(false); resetImage(); }} className="flex-1 py-2 border rounded-lg text-sm hover:bg-gray-50 cursor-pointer">取消</button>
                <button type="submit" className="flex-1 py-2 bg-[#2563EB] text-white rounded-lg text-sm hover:bg-[#1D4ED8] cursor-pointer">保存</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showCatModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowCatModal(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
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