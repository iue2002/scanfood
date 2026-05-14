export default typeof definePageConfig === 'function'
  ? definePageConfig({
      navigationBarTitleText: '数据统计',
      navigationBarBackgroundColor: '#ffffff',
      navigationBarTextStyle: 'black',
    })
  : {
      navigationBarTitleText: '数据统计',
      navigationBarBackgroundColor: '#ffffff',
      navigationBarTextStyle: 'black',
    }
