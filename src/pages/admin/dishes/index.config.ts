export default typeof definePageConfig === 'function'
  ? definePageConfig({
      navigationBarTitleText: '菜品管理',
      navigationBarBackgroundColor: '#ffffff',
      navigationBarTextStyle: 'black',
    })
  : {
      navigationBarTitleText: '菜品管理',
      navigationBarBackgroundColor: '#ffffff',
      navigationBarTextStyle: 'black',
    }
