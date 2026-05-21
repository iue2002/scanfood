import axios from 'axios'

// 开发环境走 Vite 代理（相对路径），避免跨域和 CORS 问题
// 生产环境走环境变量配置的后端地址
const baseURL = import.meta.env.VITE_API_BASE_URL || '/api'

const request = axios.create({
  baseURL,
  timeout: 30000,
})

request.interceptors.request.use((config) => {
  const token = localStorage.getItem('admin_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

request.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401) {
      // 只在已登录状态下才清除 token 并跳转
      const currentPath = window.location.pathname
      const hasToken = localStorage.getItem('admin_token')
      if (hasToken && currentPath !== '/login') {
        localStorage.removeItem('admin_token')
        localStorage.removeItem('admin_user')
        localStorage.removeItem('admin_last_login')
        window.location.href = '/login'
        return Promise.reject({ message: '登录已过期，请重新登录' })
      }
    }
    
    // 标准化错误格式：返回字符串 message
    const errData = error.response?.data
    if (errData?.message) {
      // 后端返回 { message: string | string[] }
      const msg = Array.isArray(errData.message) ? errData.message[0] : errData.message
      return Promise.reject({ message: msg, ...errData })
    }
    
    return Promise.reject(error.response?.data || error.message)
  },
)

export default request
