// app.js
const { request } = require('./utils/request');

App({
  onLaunch() {
    const logs = wx.getStorageSync('logs') || []
    logs.unshift(Date.now())
    wx.setStorageSync('logs', logs)

    this.globalData.tableId = null;
    this.globalData.carts = {};
    this.globalData.addMoreCarts = {};
    this.globalData.addMore = false;

    // 先同步检查登录状态，不阻塞启动
    this.checkLoginStatusSync();
    // 异步刷新用户信息，不阻塞页面渲染
    setTimeout(() => this.refreshUserInfoAsync(), 100);
  },

  checkLoginStatusSync() {
    const token = wx.getStorageSync('token');
    const userInfo = wx.getStorageSync('userInfo');
    
    if (token && userInfo && userInfo.id) {
      this.globalData.userInfo = userInfo;
      this.globalData.token = token;
    } else {
      wx.removeStorageSync('token');
      wx.removeStorageSync('userInfo');
    }
  },

  async refreshUserInfoAsync() {
    const token = wx.getStorageSync('token');
    if (!token) return;
    
    try {
      const user = await request({ url: '/auth/me', noLoading: true });
      wx.setStorageSync('userInfo', user);
      this.globalData.userInfo = user;
    } catch (err) {
      console.error('刷新用户信息失败', err);
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
    tableId: null,
    carts: {},
    addMoreCarts: {},
    allDishes: [],
    addMore: false
  },

  getCart(tableId) {
    const key = String(tableId);
    if (!this.globalData.carts[key]) {
      this.globalData.carts[key] = { cartCount: {}, currentOrderId: null, orderStatus: null };
    }
    return this.globalData.carts[key];
  },

  clearCart(tableId) {
    const key = String(tableId);
    this.globalData.carts[key] = { cartCount: {}, currentOrderId: null, orderStatus: null };
  },

  getAddMoreCart(tableId) {
    const key = String(tableId);
    if (!this.globalData.addMoreCarts[key]) {
      this.globalData.addMoreCarts[key] = { cartCount: {}, currentOrderId: null, orderStatus: null };
    }
    return this.globalData.addMoreCarts[key];
  },

  clearAddMoreCart(tableId) {
    const key = String(tableId);
    this.globalData.addMoreCarts[key] = { cartCount: {}, currentOrderId: null, orderStatus: null };
  }
})
