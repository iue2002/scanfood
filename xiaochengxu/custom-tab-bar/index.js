Component({
  data: {
    selected: 0,
    color: '#64748b',
    selectedColor: '#2563eb',
    borderStyle: 'white',
    backgroundColor: '#ffffff',
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
    // 给页面调用，防止重复 setData
    setSelected(index) {
      if (this.data.selected !== index) {
        this.setData({ selected: index })
      }
    },
    switchTab(e) {
      const data = e.currentTarget.dataset
      const url = data.path
      if (url !== this.data.list[this.data.selected].pagePath) {
        wx.switchTab({ url })
      }
    }
  }
})
