export default typeof definePageConfig === 'function'
  ? definePageConfig({
      navigationBarTitleText: '订单管理',
      navigationBarBackgroundColor: '#ffffff',
      navigationBarTextStyle: 'black',
    })
  : {
      navigationBarTitleText: '订单管理',
      navigationBarBackgroundColor: '#ffffff',
      navigationBarTextStyle: 'black',
    }
