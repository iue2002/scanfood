import React, { createContext, useContext, useState, useCallback } from 'react'
import { CheckCircle, AlertCircle, XCircle, Info } from 'lucide-react'

interface Toast {
  id: number
  message: string
  type: 'success' | 'error' | 'warning' | 'info'
}

interface ConfirmDialog {
  id: number
  title: string
  message: string
  onConfirm: () => void
  onCancel?: () => void
}

interface ModalContextType {
  showToast: (message: string, type?: 'success' | 'error' | 'warning' | 'info') => void
  showConfirm: (title: string, message: string, onConfirm: () => void, onCancel?: () => void) => void
}

const ModalContext = createContext<ModalContextType | undefined>(undefined)

export function useModal() {
  const context = useContext(ModalContext)
  if (!context) {
    throw new Error('useModal must be used within a ModalProvider')
  }
  return context
}

export function ModalProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null)

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info') => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 3000)
  }, [])

  const showConfirm = useCallback((title: string, message: string, onConfirm: () => void, onCancel?: () => void) => {
    const id = Date.now()
    setConfirmDialog({ id, title, message, onConfirm, onCancel })
  }, [])

  const handleConfirm = useCallback(() => {
    if (confirmDialog) {
      confirmDialog.onConfirm()
      setConfirmDialog(null)
    }
  }, [confirmDialog])

  const handleCancel = useCallback(() => {
    if (confirmDialog) {
      confirmDialog.onCancel?.()
      setConfirmDialog(null)
    }
  }, [confirmDialog])

  return (
    <ModalContext.Provider value={{ showToast, showConfirm }}>
      {children}
      {/* Toast 容器 */}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onClose={() => setToasts(prev => prev.filter(t => t.id !== toast.id))} />
        ))}
      </div>
      {/* 确认对话框 */}
      {confirmDialog && (
        <ConfirmDialogItem
          dialog={confirmDialog}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
    </ModalContext.Provider>
  )
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const configs = {
    success: { icon: CheckCircle, iconColor: 'text-[#10B981]', bgColor: 'bg-[#D1FAE5]' },
    error: { icon: XCircle, iconColor: 'text-[#EF4444]', bgColor: 'bg-red-50' },
    warning: { icon: AlertCircle, iconColor: 'text-[#F59E0B]', bgColor: 'bg-[#FEF3C7]' },
    info: { icon: Info, iconColor: 'text-[#2563EB]', bgColor: 'bg-[#EFF6FF]' },
  }

  const config = configs[toast.type]
  const Icon = config.icon

  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border border-gray-100 ${config.bgColor} animate-in fade-in slide-in-from-right-5 duration-300`}>
      <Icon className={config.iconColor} size={20} />
      <span className="text-sm text-[#0F172A]">{toast.message}</span>
      <button
        onClick={onClose}
        className="text-[#94A3B8] hover:text-[#0F172A] cursor-pointer"
      >
        <XCircle size={16} />
      </button>
    </div>
  )
}

function ConfirmDialogItem({
  dialog,
  onConfirm,
  onCancel,
}: {
  dialog: ConfirmDialog
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100] p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl animate-in zoom-in-95 duration-200">
        <div className="flex items-start gap-3 mb-4">
          <div className="p-2 bg-[#EFF6FF] rounded-full">
            <AlertCircle className="text-[#2563EB]" size={24} />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-[#0F172A] mb-1">{dialog.title}</h3>
            <p className="text-sm text-[#64748B]">{dialog.message}</p>
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 border border-[#E2E8F0] rounded-lg text-sm font-medium text-[#334155] hover:bg-[#F8FAFC] transition-colors cursor-pointer"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2.5 bg-[#2563EB] text-white rounded-lg text-sm font-medium hover:bg-[#1D4ED8] transition-colors cursor-pointer"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  )
}
