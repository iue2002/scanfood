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
        // 区分 4 种 401 原因，方便登录页给出对应文案
        // 后端 code: TOKEN_EXPIRED / TOKEN_INVALID / SESSION_REVOKED / ACCOUNT_DISABLED / TOKEN_MISSING
        const code = errData?.code || 'TOKEN_INVALID'
        const reasonMap: Record<string, string> = {
          TOKEN_EXPIRED: '登录已过期，请重新登录',
          TOKEN_INVALID: '登录信息已失效（系统更新），请重新登录',
          SESSION_REVOKED: '您的账号已在其他设备登录，请重新登录',
          ACCOUNT_DISABLED: '账号已被禁用，请联系管理员',
          TOKEN_MISSING: '请先登录',
        }
        const reason = reasonMap[code] || (errData?.message ?? '登录已过期，请重新登录')

        // 把跳转原因写入 sessionStorage（仅当前 tab 有效），登录页顶部 banner 显示
        try {
          sessionStorage.setItem('login_redirect_reason', JSON.stringify({
            code,
            reason,
            at: Date.now(),
          }))
        } catch { /* 隐私模式下 sessionStorage 可能不可写，忽略 */ }

        localStorage.removeItem('admin_token')
        localStorage.removeItem('admin_user')
        localStorage.removeItem('admin_last_login')
        // 用 replace 避免回退被卡在受保护页面
        window.location.replace('/login')
        return Promise.reject(buildErr(reason))
      }
      // 登录页 / 登录请求自身：照常 reject 让调用方处理
      return Promise.reject(buildErr(
        Array.isArray(errData?.message) ? errData.message[0] : (errData?.message || '认证失败')
      ))
    }

    // 403 处理：真实权限拒绝（已登录但角色/权限不够）→ 拒绝并给友好文案
    // 注意：未登录的 403 现在应该走 401（后端已修复 PermissionsGuard），但保留兜底
    if (status === 403) {
      const code = errData?.code
      const msg = errData?.msg || errData?.message

      // 兜底：某些边缘情况下 403 实际是"未登录"（旧版本后端 / 网关误判）
      if (msg === '需要登录后才能访问' || code === 'TOKEN_MISSING') {
        const hasToken = localStorage.getItem('admin_token')
        if (hasToken) {
          try {
            sessionStorage.setItem('login_redirect_reason', JSON.stringify({
              code: 'TOKEN_EXPIRED',
              reason: '登录已过期（会话失效），请重新登录',
              at: Date.now(),
            }))
          } catch { /* ignore */ }
          localStorage.removeItem('admin_token')
          localStorage.removeItem('admin_user')
          window.location.replace('/login')
          return Promise.reject(buildErr('登录已过期（会话失效），请重新登录'))
        }
      }

      // 真实权限拒绝 → 友好文案
      const friendlyMsg = msg || '当前角色无权执行该操作'
      return Promise.reject(buildErr(friendlyMsg))
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
