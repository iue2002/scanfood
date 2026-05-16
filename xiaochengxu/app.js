// app.js
const { request } = require('./utils/request');

App({
  onLaunch() {
    const logs = wx.getStorageSync('logs') || []
    logs.unshift(Date.now())
    wx.setStorageSync('logs', logs)

    this.checkLoginStatus();
  },

  checkLoginStatus() {
    const token = wx.getStorageSync('token');
    const userInfo = wx.getStorageSync('userInfo');
    
    if (token && userInfo && userInfo.id) {
      this.globalData.userInfo = userInfo;
      this.globalData.token = token;
      this.refreshUserInfo();
    } else {
      wx.removeStorageSync('token');
      wx.removeStorageSync('userInfo');
    }
  },

  refreshUserInfo() {
    request({
      url: '/auth/me',
      noLoading: true
    }).then(user => {
      wx.setStorageSync('userInfo', user);
      this.globalData.userInfo = user;
    }).catch(err => {
      console.error('刷新用户信息失败', err);
    });
  },

  login() {
    return new Promise((resolve, reject) => {
      wx.login({
        success: res => {
          if (res.code) {
            request({
              url: '/auth/wechat-login',
              method: 'POST',
              data: { code: res.code },
              noLoading: true
            }).then(data => {
              wx.setStorageSync('token', data.token);
              wx.setStorageSync('userInfo', data.user);
              this.globalData.userInfo = data.user;
              this.globalData.token = data.token;
              resolve(data);
            }).catch(err => {
              console.error('登录失败', err);
              reject(err);
            });
          } else {
            console.error('获取登录code失败', res.errMsg);
            reject(new Error('获取登录code失败'));
          }
        },
        fail: (err) => {
          console.error('wx.login调用失败', err);
          reject(err);
        }
      });
    });
  },

  updateUserInfo(userInfo) {
    this.globalData.userInfo = userInfo;
    wx.setStorageSync('userInfo', userInfo);
  },

  globalData: {
    userInfo: null,
    token: null,
    tableId: null
  }
})
