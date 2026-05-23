import React from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface ErrorBoundaryProps {
  children: React.ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error?: Error
}

/**
 * 全局错误边界
 * 捕获子组件渲染错误，避免整页白屏崩溃
 */
export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] 组件渲染异常', error, errorInfo)
  }

  handleReload = () => {
    // 同时清掉 SW 缓存（防止 PWA 缓存了坏响应）
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((r) => r.unregister())
      }).catch(() => { /* noop */ })
    }
    if ('caches' in window) {
      caches.keys().then((keys) => {
        keys.forEach((k) => caches.delete(k))
      }).catch(() => { /* noop */ })
    }
    window.location.reload()
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#FEF2F2] to-[#F1F5F9] p-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6 sm:p-8">
          <div className="flex flex-col items-center text-center">
            <div className="w-14 h-14 bg-[#FEE2E2] rounded-full flex items-center justify-center mb-4">
              <AlertTriangle size={28} className="text-[#EF4444]" />
            </div>
            <h2 className="text-lg font-semibold text-[#0F172A] mb-2">页面出现异常</h2>
            <p className="text-sm text-[#64748B] mb-5 break-all">
              {this.state.error?.message || '发生未知错误，请刷新重试'}
            </p>
            <button
              onClick={this.handleReload}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#2563EB] text-white rounded-lg text-sm font-medium hover:bg-[#1D4ED8] transition-colors cursor-pointer"
            >
              <RefreshCw size={14} />
              刷新页面
            </button>
          </div>
        </div>
      </div>
    )
  }
}
