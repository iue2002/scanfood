// app.js
const { request } = require('./utils/request');

App({
  onLaunch() {
    // 展示本地存储能力
    const logs = wx.getStorageSync('logs') || []
    logs.unshift(Date.now())
    wx.setStorageSync('logs', logs)

    // 自动登录
    this.login();
  },

  login() {
    return new Promise((resolve, reject) => {
      wx.login({
        success: res => {
          if (res.code) {
            request({
              url: '/auth/wechat-login',
              method: 'POST',
              data: { code: res.code }
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
          }
        }
      });
    });
  },

  globalData: {
    userInfo: null,
    token: null,
    tableId: null // 当前扫码绑定的桌台ID
  }
})
