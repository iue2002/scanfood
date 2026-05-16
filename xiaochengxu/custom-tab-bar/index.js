Component({
  data: {
    selected: 0,
    color: '#999999',
    selectedColor: '#333333',
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
    if (index !== -1) {
      this.setData({ selected: index })
    }
  },
  methods: {
    switchTab(e) {
      const data = e.currentTarget.dataset
      const url = data.path
      if (url !== this.data.list[this.data.selected].pagePath) {
        wx.switchTab({ url })
      }
    }
  }
})
