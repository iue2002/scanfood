import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './stores/auth'
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

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token)
  return token ? <>{children}</> : <Navigate to="/login" replace />
}

export default function App() {
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
