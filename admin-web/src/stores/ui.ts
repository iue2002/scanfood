import { create } from 'zustand'

export type FontSize = 'small' | 'medium' | 'large'

interface UiState {
  fontSize: FontSize
  setFontSize: (size: FontSize) => void
}

const STORAGE_KEY = 'admin_font_size'

const getInitialFontSize = (): FontSize => {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw === 'small' || raw === 'medium' || raw === 'large') return raw
  return 'medium'
}

export const useUiStore = create<UiState>((set) => ({
  fontSize: getInitialFontSize(),
  setFontSize: (size) => {
    localStorage.setItem(STORAGE_KEY, size)
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.fontSize = size
    }
    set({ fontSize: size })
  },
}))
