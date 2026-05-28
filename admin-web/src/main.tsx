import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import './index.css'

// 初始化字体大小偏好（先于 React render，避免闪屏）
const savedFontSize = localStorage.getItem('admin_font_size')
if (savedFontSize === 'small' || savedFontSize === 'medium' || savedFontSize === 'large') {
  document.documentElement.dataset.fontSize = savedFontSize
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
)
