export default typeof definePageConfig === 'function'
  ? definePageConfig({
      navigationBarTitleText: '登录',
      navigationBarBackgroundColor: '#ffffff',
      navigationBarTextStyle: 'black',
    })
  : {
      navigationBarTitleText: '登录',
      navigationBarBackgroundColor: '#ffffff',
      navigationBarTextStyle: 'black',
    }
