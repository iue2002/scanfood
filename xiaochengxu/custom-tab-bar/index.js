Component({
  data: {
    selected: 0,
    color: '#64748b',
    selectedColor: '#2563eb',
    borderStyle: 'white',
    backgroundColor: '#ffffff',
    hidden: false,
    list: [
      {
        pagePath: '/pages/order/order',
        text: '浏览'
      },
      {
        pagePath: '/pages/me/me',
        text: '我的'
      }
    ]
  },
  attached() {
    const pages = getCurrentPages()
    if (!pages || pages.length === 0) {
      return
    }
    const currentPage = pages[pages.length - 1]
    if (!currentPage || !currentPage.route) {
      return
    }
    const route = '/' + currentPage.route
    const index = this.data.list.findIndex(item => item.pagePath === route)
    if (index !== -1 && this.data.selected !== index) {
      this.setData({ selected: index })
    }
  },
  methods: {
    setSelected(index) {
      if (this.data.selected !== index) {
        this.setData({ selected: index })
      }
    },
    setHidden(hidden) {
      if (this.data.hidden !== hidden) {
        this.setData({ hidden })
      }
    },
    switchTab(e) {
      const data = e.currentTarget.dataset
      const url = data.path
      const pages = getCurrentPages()
      const currentPage = pages && pages[pages.length - 1]
      const currentRoute = currentPage && currentPage.route
      const isOnOrderPage = currentRoute === 'pages/order/order'
      const isOnMePage = currentRoute === 'pages/me/me'

      // 锁定模式（强制完成订单中）：所有 TabBar 切换都禁止
      if (isOnOrderPage && currentPage.data && currentPage.data.showDetailSheet && currentPage.data.detailLocked) {
        wx.showToast({ title: '请先完成当前订单', icon: 'none' })
        return
      }

      // "我的"标签拦截：通过 globalData 让 order 页打开 me-sheet 而不是真切页
      if (url === '/pages/me/me') {
        const app = getApp()

        // 当前已经在 order 页：直接通知打开 sheet
        if (isOnOrderPage && typeof currentPage.openMeSheet === 'function') {
          this.setData({ selected: 1 })
          currentPage.openMeSheet()
          return
        }

        // 当前在 me 中转页（罕见：onShow 还没跑）：触发 reLaunch 强制刷新 order 页栈
        // 小程序的 wx.switchTab 在某些状态下会被合并/忽略，reLaunch 是最稳的兜底
        if (app && app.globalData) {
          app.globalData.openMeOnNextShow = true
        }
        if (isOnMePage) {
          // 当前已经在 me 页，wx.switchTab 可能不触发回调，用 reLaunch 强制重置
          wx.reLaunch({ url: '/pages/order/order' })
        } else {
          wx.switchTab({ url: '/pages/order/order' })
        }
        return
      }

      // "浏览"标签：如果 me-sheet 打开，关闭它而不是真切页
      if (url === '/pages/order/order' && isOnOrderPage && currentPage.data && currentPage.data.showMeSheet) {
        if (typeof currentPage.onMeSheetClose === 'function') {
          currentPage.onMeSheetClose()
          this.setData({ selected: 0 })
          return
        }
      }

      if (url !== this.data.list[this.data.selected].pagePath) {
        wx.switchTab({ url })
      }
    }
  }
})
