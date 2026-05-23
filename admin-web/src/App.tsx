import { useState, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { WifiOff } from 'lucide-react'
import request from './api/request'
import Layout from './components/Layout'
import Login from './pages/Login'
import TableBoard from './pages/TableBoard'
import Dashboard from './pages/Dashboard'
import TableManage from './pages/TableManage'
import OrderManage from './pages/OrderManage'
import DishManage from './pages/DishManage'
import RefundManage from './pages/RefundManage'
import Statistics from './pages/Statistics'
import StoreSettings from './pages/StoreSettings'
import { ModalProvider } from './components/ModalProvider'
import { WebSocketProvider } from './components/WebSocketProvider'
import { UnreadProvider } from './components/UnreadProvider'
import NotificationCenter from './components/NotificationCenter'
import { useAuthStore } from './stores/auth'

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore(state => state.token)
  return token ? <>{children}</> : <Navigate to="/login" replace />
}

export default function App() {
  const [isChecking, setIsChecking] = useState(true)
  const [networkError, setNetworkError] = useState(false)

  useEffect(() => {
    const verifyToken = async () => {
      const token = localStorage.getItem('admin_token')
      if (!token) {
        setIsChecking(false)
        return
      }

      try {
        const res: any = await request.get('/auth/verify')
        if (res?.user) {
          localStorage.setItem('admin_user', JSON.stringify(res.user))
          setNetworkError(false)
        } else {
          throw new Error('Invalid token')
        }
      } catch (err: any) {
        // 区分网络错误和认证错误
        if (!err.response && err.code === 'ERR_NETWORK') {
          setNetworkError(true)
          // 网络不通但保留 token，下次恢复时可继续使用
        } else {
          localStorage.removeItem('admin_token')
          localStorage.removeItem('admin_user')
        }
      } finally {
        setIsChecking(false)
      }
    }

    verifyToken()
  }, [])

  if (isChecking) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3">
        <div className="w-8 h-8 border-4 border-[#2563EB] border-t-transparent rounded-full animate-spin"></div>
        <p className="text-sm text-[#94A3B8]">正在连接服务器...</p>
      </div>
    )
  }

  if (networkError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-6">
        <div className="w-16 h-16 rounded-full bg-[#FEF2F2] flex items-center justify-center">
          <WifiOff className="w-8 h-8 text-[#EF4444]" />
        </div>
        <div className="text-center">
          <h2 className="text-lg font-semibold text-[#0F172A] mb-1">无法连接到服务器</h2>
          <p className="text-sm text-[#64748B] max-w-xs">
            请检查后端服务是否已启动，或网络连接是否正常
          </p>
        </div>
        <button
          onClick={() => {
            setNetworkError(false)
            setIsChecking(true)
            window.location.reload()
          }}
          className="px-5 py-2.5 bg-[#2563EB] text-white rounded-lg text-sm font-medium hover:bg-[#1D4ED8] transition-colors"
        >
          重新连接
        </button>
      </div>
    )
  }

  return (
    <ModalProvider>
      <WebSocketProvider>
        <UnreadProvider>
          <NotificationCenter />
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/"
              element={
                <PrivateRoute>
                  <Layout />
                </PrivateRoute>
              }
            >
              <Route index element={<TableBoard />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="tables" element={<TableManage />} />
              <Route path="orders" element={<OrderManage />} />
              <Route path="dishes" element={<DishManage />} />
              <Route path="refunds" element={<RefundManage />} />
              <Route path="statistics" element={<Statistics />} />
              <Route path="store-settings" element={<StoreSettings />} />
            </Route>
          </Routes>
        </UnreadProvider>
      </WebSocketProvider>
    </ModalProvider>
  )
}
