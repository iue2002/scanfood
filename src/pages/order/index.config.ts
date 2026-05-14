export default typeof definePageConfig === 'function'
  ? definePageConfig({
      navigationBarTitleText: '点餐',
      navigationBarBackgroundColor: '#ffffff',
      navigationBarTextStyle: 'black',
    })
  : {
      navigationBarTitleText: '点餐',
      navigationBarBackgroundColor: '#ffffff',
      navigationBarTextStyle: 'black',
    }
