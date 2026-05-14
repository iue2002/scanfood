export default typeof definePageConfig === 'function'
  ? definePageConfig({
      navigationBarTitleText: '桌台管理',
      navigationBarBackgroundColor: '#ffffff',
      navigationBarTextStyle: 'black',
    })
  : {
      navigationBarTitleText: '桌台管理',
      navigationBarBackgroundColor: '#ffffff',
      navigationBarTextStyle: 'black',
    }
