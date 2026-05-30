import { useState, useEffect, lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { WifiOff, Loader2 } from 'lucide-react'
import request from './api/request'
import Layout from './components/Layout'
import Login from './pages/Login'
import TableBoard from './pages/TableBoard'
import Dashboard from './pages/Dashboard'
import TableManage from './pages/TableManage'
import DishManage from './pages/DishManage'
import RefundManage from './pages/RefundManage'
import StoreSettings from './pages/StoreSettings'
import EmployeeManage from './pages/EmployeeManage'
import AuditLogs from './pages/AuditLogs'
import NotifSettings from './pages/NotifSettings'
import PrintPlanManage from './pages/PrintPlanManage'
import Forbidden from './pages/Forbidden'
import ForcePasswordChange from './pages/ForcePasswordChange'
import AccountSettings from './pages/AccountSettings'
import { ModalProvider } from './components/ModalProvider'
import { WebSocketProvider } from './components/WebSocketProvider'
import { UnreadProvider } from './components/UnreadProvider'
import NotificationCenter from './components/NotificationCenter'
import NotificationClickHandler from './components/NotificationClickHandler'
import { RoleGuard } from './rbac/RoleGuard'
import { useAuthStore } from './stores/auth'

// P2-2：大页面懒加载（仅最大 4 个页面，减少首屏 JS 体积）
const OrderManage   = lazy(() => import('./pages/OrderManage'))
const Statistics    = lazy(() => import('./pages/Statistics'))
const PrinterManage = lazy(() => import('./pages/PrinterManage'))
const DataExport    = lazy(() => import('./pages/DataExport'))

const PageLoader = () => (
  <div className="flex items-center justify-center py-20">
    <Loader2 className="w-6 h-6 animate-spin text-[#2563EB]" />
  </div>
)

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
          <NotificationClickHandler />
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/force-password-change" element={
              <PrivateRoute><ForcePasswordChange /></PrivateRoute>
            } />
            <Route
              path="/"
              element={
                <PrivateRoute>
                  <Layout />
                </PrivateRoute>
              }
            >
              <Route index element={<TableBoard />} />
              <Route path="orders" element={<Suspense fallback={<PageLoader />}><OrderManage /></Suspense>} />
              <Route path="dashboard" element={
                <RoleGuard requiredRoles={['owner', 'admin']}>
                  <Dashboard />
                </RoleGuard>
              } />
              <Route path="statistics" element={
                <RoleGuard requiredRoles={['owner', 'admin']}>
                  <Suspense fallback={<PageLoader />}><Statistics /></Suspense>
                </RoleGuard>
              } />
              <Route path="tables" element={
                <RoleGuard requiredRoles={['owner', 'manager', 'admin']}>
                  <TableManage />
                </RoleGuard>
              } />
              <Route path="dishes" element={
                <RoleGuard requiredRoles={['owner', 'manager', 'admin']}>
                  <DishManage />
                </RoleGuard>
              } />
              <Route path="refunds" element={
                <RoleGuard requiredRoles={['owner', 'manager', 'admin']}>
                  <RefundManage />
                </RoleGuard>
              } />
              <Route path="store-settings" element={
                <RoleGuard requiredRoles={['owner', 'manager', 'admin']}>
                  <StoreSettings />
                </RoleGuard>
              } />
              <Route path="employees" element={
                <RoleGuard requiredRoles={['owner', 'admin']}>
                  <EmployeeManage />
                </RoleGuard>
              } />
              <Route path="audit-logs" element={
                <RoleGuard requiredRoles={['owner', 'manager', 'admin']}>
                  <AuditLogs />
                </RoleGuard>
              } />
              <Route path="data-export" element={
                <RoleGuard requiredRoles={['owner', 'admin']}>
                  <Suspense fallback={<PageLoader />}><DataExport /></Suspense>
                </RoleGuard>
              } />
              <Route path="printers" element={
                <RoleGuard requiredRoles={['owner', 'manager', 'admin']}>
                  <Suspense fallback={<PageLoader />}><PrinterManage /></Suspense>
                </RoleGuard>
              } />
              <Route path="print-plans" element={
                <RoleGuard requiredRoles={['owner', 'manager', 'admin']}>
                  <PrintPlanManage />
                </RoleGuard>
              } />
              <Route path="notif-settings" element={<NotifSettings />} />
              <Route path="account-settings" element={<AccountSettings />} />
              <Route path="forbidden" element={<Forbidden />} />
            </Route>
          </Routes>
        </UnreadProvider>
      </WebSocketProvider>
    </ModalProvider>
  )
}
