// app.js
const { request } = require('./utils/request');
const dishesCache = require('./utils/dishes-cache');

App({
  onLaunch() {
    this.globalData.tableId = null;
    this.globalData.carts = {};
    this.globalData.addMoreCarts = {};
    this.globalData.addMore = false;

    // 先同步检查登录状态，不阻塞启动
    this.checkLoginStatusSync();
    // 异步刷新用户信息，不阻塞页面渲染
    setTimeout(() => this.refreshUserInfoAsync(), 100);
    // 启动时预热 dishes 缓存（后台静默拉取，不阻塞首屏）
    setTimeout(() => {
      dishesCache.getDishes().catch(() => { /* noop */ });
    }, 200);
    // 启动时拉店铺信息（店名 + 头像），缓存到 globalData 给所有页面用
    setTimeout(() => {
      this.loadStoreInfo().catch(() => { /* noop */ });
    }, 300);
  },

  // 拉取店铺信息：优先用本地缓存即时返回，再异步刷新一份新的
  // 节流：默认 5 分钟内不重复请求；force=true 跳过节流（用于下拉刷新等显式动作）
  // 设计思路：店名/头像变更频率极低，顾客一次用餐内最多刷 1-2 次足矣，
  //          商家在 admin 改完最坏 5 分钟全店顾客能看到。
  async loadStoreInfo(force = false) {
    // 同步从 storage 拿（启动瞬间就能用）
    const cached = wx.getStorageSync('storeInfo');
    if (cached && cached.store_name && !this.globalData.storeInfo) {
      this.globalData.storeInfo = cached;
    }

    // 节流：5 分钟内只拉一次（onShow 频繁触发时保护后端）
    const STORE_INFO_TTL_MS = 5 * 60 * 1000;
    const now = Date.now();
    const last = this._storeInfoLastFetchAt || 0;
    if (!force && now - last < STORE_INFO_TTL_MS) {
      return this.globalData.storeInfo;
    }

    // 同时只允许一个请求在飞（避免快速切页造成的请求堆积）
    if (this._storeInfoInflight) {
      return this._storeInfoInflight;
    }

    this._storeInfoLastFetchAt = now;
    this._storeInfoInflight = (async () => {
      try {
        const res = await request({ url: '/store-settings', noLoading: true });
        const info = res?.data || res;
        if (info && info.store_name) {
          const { SERVER_URL } = require('./config');
          let avatar = info.store_avatar || '';
          if (avatar && !avatar.startsWith('http')) {
            avatar = SERVER_URL + (avatar.startsWith('/') ? '' : '/') + avatar;
          }
          const normalized = { store_name: info.store_name, store_avatar: avatar };

          // 仅在内容变化时才广播，避免无用 setData
          const old = this.globalData.storeInfo || {};
          const changed = old.store_name !== normalized.store_name || old.store_avatar !== normalized.store_avatar;

          this.globalData.storeInfo = normalized;
          wx.setStorageSync('storeInfo', normalized);

          if (changed) {
            this._notifyStoreInfoChange(normalized);
          }
          return normalized;
        }
      } catch (err) {
        console.warn('拉店铺信息失败，使用本地缓存', err);
      } finally {
        this._storeInfoInflight = null;
      }
      return this.globalData.storeInfo;
    })();
    return this._storeInfoInflight;
  },

  // ===== 店铺信息变更广播 =====
  // 让页面/组件订阅一次，而非各自轮询 globalData
  _storeInfoSubscribers: [],
  subscribeStoreInfo(fn) {
    if (typeof fn !== 'function') return () => {};
    this._storeInfoSubscribers.push(fn);
    // 立即推一次当前值，调用者无需先读 globalData
    if (this.globalData.storeInfo) {
      try { fn(this.globalData.storeInfo); } catch (e) { /* ignore */ }
    }
    return () => {
      const idx = this._storeInfoSubscribers.indexOf(fn);
      if (idx >= 0) this._storeInfoSubscribers.splice(idx, 1);
    };
  },
  _notifyStoreInfoChange(info) {
    for (const fn of this._storeInfoSubscribers) {
      try { fn(info); } catch (e) { /* ignore */ }
    }
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
      
      if (user && user.table_number) {
        try {
          const activeOrder = await request({ url: '/orders/my-active', noLoading: true });
          if (!activeOrder || !activeOrder.id) {
            user.table_number = null;
            console.log('检测到无活跃订单，已清除历史桌号');
          } else {
            console.log('检测到活跃订单，保留桌号（支持加餐）:', user.table_number);
          }
        } catch (checkErr) {
          console.warn('检查活跃订单失败，保留当前桌号', checkErr);
        }
      }
      
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
    addMore: false,
    storeInfo: null
  },

  getCart(tableId) {
    const key = String(tableId);
    if (!this.globalData.carts[key]) {
      this.globalData.carts[key] = { cartCount: {}, currentCartId: null, currentOrderId: null, orderStatus: null };
    }
    return this.globalData.carts[key];
  },

  clearCart(tableId) {
    const key = String(tableId);
    this.globalData.carts[key] = { cartCount: {}, currentCartId: null, currentOrderId: null, orderStatus: null };
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
