export default typeof definePageConfig === 'function'
  ? definePageConfig({
      navigationBarTitleText: '后台管理',
      navigationBarBackgroundColor: '#ffffff',
      navigationBarTextStyle: 'black',
    })
  : {
      navigationBarTitleText: '后台管理',
      navigationBarBackgroundColor: '#ffffff',
      navigationBarTextStyle: 'black',
    }
