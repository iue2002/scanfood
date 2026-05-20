import { create } from 'zustand'

interface User {
  id: number
  username: string
  role: string
  nickname?: string
}

interface LastLogin {
  at: string    // ISO 时间字符串
  ip: string
}

interface AuthState {
  token: string | null
  user: User | null
  lastLogin: LastLogin | null
  setAuth: (token: string, user: User, lastLogin?: LastLogin) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem('admin_token'),
  user: (() => {
    const raw = localStorage.getItem('admin_user')
    return raw ? JSON.parse(raw) : null
  })(),
  lastLogin: (() => {
    const raw = localStorage.getItem('admin_last_login')
    return raw ? JSON.parse(raw) : null
  })(),
  setAuth: (token, user, lastLogin) => {
    localStorage.setItem('admin_token', token)
    localStorage.setItem('admin_user', JSON.stringify(user))
    if (lastLogin) {
      localStorage.setItem('admin_last_login', JSON.stringify(lastLogin))
    } else {
      localStorage.removeItem('admin_last_login')
    }
    set({ token, user, lastLogin: lastLogin || null })
  },
  logout: () => {
    localStorage.removeItem('admin_token')
    localStorage.removeItem('admin_user')
    localStorage.removeItem('admin_last_login')
    set({ token: null, user: null, lastLogin: null })
  },
}))
