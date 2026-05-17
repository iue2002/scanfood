import { useState, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
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
import { ModalProvider } from './components/ModalProvider'
import { useAuthStore } from './stores/auth'

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore(state => state.token)
  return token ? <>{children}</> : <Navigate to="/login" replace />
}

export default function App() {
  const [isChecking, setIsChecking] = useState(true)
  const [loginFailed, setLoginFailed] = useState(false)
  
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
        } else {
          throw new Error('Invalid token')
        }
      } catch {
        localStorage.removeItem('admin_token')
        localStorage.removeItem('admin_user')
        setLoginFailed(true)
      } finally {
        setIsChecking(false)
      }
    }
    
    verifyToken()
  }, [])
  
  if (isChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-[#2563EB] border-t-transparent rounded-full animate-spin"></div>
      </div>
    )
  }
  
  if (loginFailed) {
    return <Navigate to="/login" replace />
  }
  
  return (
    <ModalProvider>
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
        </Route>
      </Routes>
    </ModalProvider>
  )
}
