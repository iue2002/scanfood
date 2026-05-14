export default typeof definePageConfig === 'function'
  ? definePageConfig({
      navigationBarTitleText: '订单详情',
      navigationBarBackgroundColor: '#ffffff',
      navigationBarTextStyle: 'black',
    })
  : {
      navigationBarTitleText: '订单详情',
      navigationBarBackgroundColor: '#ffffff',
      navigationBarTextStyle: 'black',
    }
