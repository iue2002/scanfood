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
    const errData = error.response?.data
    const status = error.response?.status

    // 标准化错误：所有从这里走的 reject 必须是 plain object 且带 message 字段
    const buildErr = (msg: string, extra?: Record<string, any>) => ({
      message: msg,
      ...(typeof errData === 'object' && errData !== null ? errData : {}),
      ...(extra || {}),
    })

    // 401 处理：仅"已登录用户访问受保护接口"才清 token + 跳登录页
    // 登录接口本身的 401（密码错/验证码错）必须走 reject，让 Login 页处理
    if (status === 401) {
      const currentPath = window.location.pathname
      const hasToken = localStorage.getItem('admin_token')
      const url = error.config?.url || ''
      const isLoginRequest = url.includes('/auth/login') || url.includes('/auth/captcha')

      if (hasToken && currentPath !== '/login' && !isLoginRequest) {
        localStorage.removeItem('admin_token')
        localStorage.removeItem('admin_user')
        localStorage.removeItem('admin_last_login')
        window.location.href = '/login'
        return Promise.reject(buildErr('登录已过期，请重新登录'))
      }
      // 登录页 / 登录请求自身：照常 reject 让调用方处理
      return Promise.reject(buildErr(
        Array.isArray(errData?.message) ? errData.message[0] : (errData?.message || '认证失败')
      ))
    }

    // 其它错误
    if (errData?.message) {
      const msg = Array.isArray(errData.message) ? errData.message[0] : errData.message
      return Promise.reject(buildErr(msg))
    }

    return Promise.reject(buildErr(error.message || '请求失败'))
  },
)

export default request
