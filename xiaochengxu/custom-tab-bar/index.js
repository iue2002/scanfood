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
      const isOnOrderPage = currentPage && currentPage.route === 'pages/order/order'

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
        // 当前不在 order 页：先打开 order 页，再让 onShow 时打开 sheet
        if (app && app.globalData) {
          app.globalData.openMeOnNextShow = true
        }
        wx.switchTab({ url: '/pages/order/order' })
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
