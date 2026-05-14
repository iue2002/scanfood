export default defineAppConfig({
  pages: [
    'pages/index/index',
    'pages/login/index',
    'pages/order/index',
    'pages/order-detail/index',
    'pages/admin/index/index',
    'pages/admin/tables/index',
    'pages/admin/orders/index',
    'pages/admin/dishes/index',
    'pages/admin/statistics/index',
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#ffffff',
    navigationBarTitleText: '桌码点餐',
    navigationBarTextStyle: 'black'
  },
  tabBar: {
    color: '#999999',
    selectedColor: '#f97316',
    backgroundColor: '#ffffff',
    borderStyle: 'black',
    list: [
      {
        pagePath: 'pages/index/index',
        text: '首页',
        iconPath: './assets/tabbar/home.png',
        selectedIconPath: './assets/tabbar/home-active.png',
      },
      {
        pagePath: 'pages/admin/index/index',
        text: '管理',
        iconPath: './assets/tabbar/settings.png',
        selectedIconPath: './assets/tabbar/settings-active.png',
      }
    ]
  }
})
