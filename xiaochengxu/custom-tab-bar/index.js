// custom-tab-bar/index.js
// 真页面架构：TabBar 只做标准 switchTab，不再拦截「我的」/「浏览」打开 sheet
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
    if (!pages || pages.length === 0) return
    const currentPage = pages[pages.length - 1]
    if (!currentPage || !currentPage.route) return
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
      const index = data.index
      console.log('[TabBar] switchTab tap', { url, index, currentSelected: this.data.selected })

      // 已经在当前 tab：什么都不做
      if (index === this.data.selected) {
        console.log('[TabBar] 已在当前 tab，跳过')
        return
      }

      // 立即更新 UI 状态（不等 switchTab 回调，避免视觉延迟）
      this.setData({ selected: index })

      wx.switchTab({
        url,
        success: () => {
          console.log('[TabBar] switchTab 成功:', url)
        },
        fail: (err) => {
          console.error('[TabBar] switchTab 失败:', err, 'url=', url)
          // 回滚 UI 状态
          this.setData({ selected: this.data.selected === index ? (1 - index) : this.data.selected })
          wx.showToast({ title: '切换失败：' + (err.errMsg || ''), icon: 'none' })
        }
      })
    }
  }
})
