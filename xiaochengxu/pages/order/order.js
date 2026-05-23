// pages/order/order.js
const { request, serverURL } = require('../../utils/request');

Page({
  data: {
    tableId: '',
    tableNumber: '',
    categories: [],
    currentCategory: '',
    currentCategoryName: '',
    allDishes: [], 
    dishes: [],    
    cartCount: {}, 
    totalCount: 0,
    totalPrice: 0,
    currentCartId: null,
    currentOrderId: null,
    orderStatus: null,
    hasScannedTable: false,
    isAddMore: false,
    // 数量输入弹窗
    showQtyModal: false,
    editDishId: null,
    editDishName: '',
    editDishCount: 0,
    // 购物车弹窗
    showCartPanel: false,
    cartItems: [],
    // "我的"全屏弹窗（替代 wx.switchTab → me 页）
    showMeSheet: false,
    // "确认订单"全屏弹窗（替代 wx.navigateTo → confirm 页）
    showConfirmSheet: false,
    // "订单详情"全屏弹窗（替代 wx.navigateTo → detail 页）
    showDetailSheet: false,
    detailOrderId: ''
  },

  // 业务实例字段（不放 data，避免触发 setData）
  isFetchingOrder: false,
  ws: null,
  _syncTimer: null,           // 同步购物车防抖定时器
  _lastSyncedSnapshot: null,  // 最近一次发起同步时的 cartCount 快照
  _lastSyncAt: 0,             // 最近一次本地同步发起时间，用于忽略 ws 回声
  _lastActiveCheckAt: 0,      // 最近一次检查 my-active 时间，节流避免 onShow 反复请求
  _lastOnShowAt: 0,           // 最近一次 onShow 时间，用于跳过短时间频繁切换的请求

  async onLoad(options) {
    let tableNumber = null;
    let rawTableId = options.tableId;

    if (options.scene) {
      // scene参数是URL编码的，需要解码
      // 微信扫码进入时，scene就是桌台编号（如 "01"）
      try {
        const scene = decodeURIComponent(options.scene);
        console.log('解析 scene:', scene);
        if (scene) {
          tableNumber = scene;
        }
      } catch (e) {
        console.error('解析scene参数失败', e);
      }
    }

    // 先验证桌号再设置页面数据，避免无效桌号显示在页面上
    if (tableNumber) {
      this.fetchTableInfoByNumber(tableNumber);
    } else if (rawTableId) {
      const tableId = String(rawTableId).replace(/[^\d]/g, '');
      if (tableId) {
        this.setData({ tableId, hasScannedTable: true });
        getApp().globalData.tableId = tableId;
        this.fetchTableInfo(tableId);
      }
    }
    this.fetchData();

    // 异步检查未付款订单，不阻塞页面渲染
    this.checkActiveOrderAsync();
  },

  async checkActiveOrderAsync() {
    // 30 秒内只查一次，避免 TabBar 来回切时反复请求
    if (this._lastActiveCheckAt && Date.now() - this._lastActiveCheckAt < 30000) {
      return;
    }
    this._lastActiveCheckAt = Date.now();

    try {
      const token = wx.getStorageSync('token');
      if (!token) {
        console.log('未登录，跳过检查未完成订单');
        return;
      }
      const order = await request({ url: '/orders/my-active', noLoading: true });
      if (order && order.id) {
        this.openDetailSheet(order.id);
      }
    } catch (err) {
      console.log('没有未完成的订单', err);
    }
  },

  async checkActiveOrder() {
    try {
      const token = wx.getStorageSync('token');
      if (!token) {
        console.log('未登录，跳过检查未完成订单');
        // 未登录时也释放桌号资源
        if (this.data.tableId) {
          this.releaseTableResources();
        }
        return false;
      }
      const order = await request({ url: '/orders/my-active', noLoading: true });
      console.log('checkActiveOrder 结果:', order);
      if (order && order.id) {
        // 有未完成订单：直接打开详情弹窗（不再走页面跳转）
        this.openDetailSheet(order.id);
        return true;
      }
      // 没有未完成订单，释放桌号资源
      if (this.data.tableId) {
        this.releaseTableResources();
      }
      return false;
    } catch (err) {
      console.log('没有未完成的订单', err);
      // 请求失败也释放桌号资源
      if (this.data.tableId) {
        this.releaseTableResources();
      }
      return false;
    }
  },

  onReady() {
    this.modal = this.selectComponent('#themeModal');
  },

  async onShow() {
    // 检查是否需要自动打开"我的"弹窗（从其它非 TabBar 页点底部"我的"切回时）
    const app = getApp();
    if (app && app.globalData && app.globalData.openMeOnNextShow) {
      app.globalData.openMeOnNextShow = false;
      this.openMeSheet();
    }

    // 先处理页面状态，让用户立即看到内容
    if (app.globalData.addMore) {
      app.globalData.addMore = false;
      if (!this.data.isAddMore) {
        this.setData({ isAddMore: true });
      }
    }

    // 节流：onShow 间隔太短直接跳过（30 秒内频繁切换 TabBar）
    const now = Date.now();
    const isSecondShow = this._lastOnShowAt && now - this._lastOnShowAt < 30000;
    this._lastOnShowAt = now;

    if (this.data.tableId && !this.data.isAddMore) {
      const cart = getApp().getCart(this.data.tableId);
      const cartCount = cart.cartCount || {};
      const hasLocalData = Object.values(cartCount).some(count => count > 0);

      if (hasLocalData) {
        // 本地有购物车数据，恢复 UI（仅在内容变了才 setData）
        if (!this.cartCountEqual(this.data.cartCount, cartCount) ||
            this.data.currentCartId !== (cart.currentCartId || null)) {
          this.setData({
            cartCount: { ...cartCount },
            currentCartId: cart.currentCartId || null,
            currentOrderId: null,
            orderStatus: null
          });
          this.calculateTotal();
        }
      } else if (!isSecondShow) {
        // 首次 onShow（或长时间未 show）才发请求；30 秒内频繁切跳过
        this.fetchCurrentCart();
      }
    } else if (this.data.tableId && this.data.isAddMore) {
      const addMoreCart = getApp().getAddMoreCart(this.data.tableId);
      if (!addMoreCart.currentOrderId && !isSecondShow) {
        this.fetchCurrentOrderForAddMore();
      } else if (addMoreCart.currentOrderId) {
        if (!this.cartCountEqual(this.data.cartCount, addMoreCart.cartCount || {}) ||
            this.data.currentOrderId !== addMoreCart.currentOrderId) {
          this.setData({
            cartCount: { ...addMoreCart.cartCount },
            currentOrderId: addMoreCart.currentOrderId,
            orderStatus: addMoreCart.orderStatus
          });
          this.calculateTotal();
        }
      }
    }
    this.updateTabBar();

    // 异步检查未付款订单（已节流），不阻塞页面显示
    if (!isSecondShow) {
      this.checkActiveOrderAsync();
    }
  },

  async onPullDownRefresh() {
    console.log('下拉刷新 - 重新加载菜品和订单');
    try {
      await this.fetchData();
      if (this.data.tableId) {
        await this.fetchCurrentCart();
      }
      wx.stopPullDownRefresh();
    } catch (err) {
      console.error('下拉刷新失败', err);
      wx.stopPullDownRefresh();
    }
  },

  updateTabBar() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      const tabBar = this.getTabBar();
      // 幂等：值没变就不 setData
      if (tabBar.setSelected) {
        tabBar.setSelected(0);
      } else if (tabBar.data && tabBar.data.selected !== 0) {
        tabBar.setData({ selected: 0 });
      }
    }
  },

  onUnload() {
    if (this._syncTimer) {
      clearTimeout(this._syncTimer);
      this._syncTimer = null;
    }
    this.closeWebSocket();
  },

  initWebSocket() {
    if (!this.data.tableId) return;
    if (this._wsConnecting || this._wsConnected) return;

    const token = wx.getStorageSync('token');
    if (!token) return;

    this._wsConnecting = true;
    const wsUrl = serverURL.replace('http', 'ws').replace('https', 'wss') + `/ws?token=${token}`;
    console.log('连接 WebSocket:', wsUrl);
    
    this.ws = wx.connectSocket({
      url: wsUrl,
    });

    this.ws.onOpen(() => {
      console.log('WebSocket 已打开，订阅桌台:', this.data.tableId);
      this._wsConnected = true;
      this._wsConnecting = false;
      this._reconnectDelay = 1000;
      this.ws.send({
        data: JSON.stringify({
          event: 'subscribeTable',
          data: { tableId: this.data.tableId }
        })
      });
    });

    this.ws.onMessage((res) => {
      try {
        const message = JSON.parse(res.data);
        console.log('收到 WebSocket 消息:', message);
        
        if (message.event === 'cartUpdated') {
          this.handleCartUpdate(message.data);
        } else if (message.event === 'orderUpdated' || message.event === 'orderStatusChanged') {
          this.handleOrderUpdate(message.data);
        }
      } catch (err) {
        console.error('解析 WebSocket 消息失败', err);
      }
    });

    this.ws.onError((err) => {
      console.error('WebSocket 错误', err);
      this._wsConnected = false;
      this._wsConnecting = false;
    });

    this.ws.onClose((res) => {
      console.log('WebSocket 连接关闭, code:', res.code);
      this._wsConnected = false;
      this._wsConnecting = false;
      this.ws = null;

      // 已结账或取消的订单不再重连
      const orderStatus = (getApp().getCart(this.data.tableId) || {}).orderStatus;
      if (orderStatus === 'settled' || orderStatus === 'cancelled') return;

      // 指数退避重连
      const delay = this._reconnectDelay || 1000;
      this._reconnectDelay = Math.min((this._reconnectDelay || 1000) * 2, 30000);
      console.log(`[WS] ${delay}ms 后尝试重连`);
      this._reconnectTimer = setTimeout(() => {
        this._reconnectTimer = null;
        this.initWebSocket();
      }, delay);
    });
  },

  closeWebSocket() {
    this._wsConnected = false;
    this._wsConnecting = false;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close({ code: 1000, reason: 'page unload' });
      } catch (e) {}
      this.ws = null;
    }
  },

  handleOrderUpdate(order) {
    console.log('处理订单更新:', order);
    
    if (order && (order.status === 'submitted' || order.status === 'printed' || order.status === 'unpaid')) {
      if (this.data.isAddMore) {
        return;
      }
      this.openDetailSheet(order.id);
    } else if (order && (order.status === 'settled' || order.status === 'cancelled')) {
      // 订单已结账或取消，立即释放所有桌号资源
      this.releaseTableResources();
    }
  },

  handleCartUpdate(cart) {
    // 忽略本地刚刚同步上去的回声（1.5 秒内）——避免输入抖动闪屏
    if (this._lastSyncAt && Date.now() - this._lastSyncAt < 1500) {
      return;
    }

    if (!cart || !cart.cart_items) {
      const emptyCart = getApp().getCart(this.data.tableId);
      emptyCart.cartCount = {};
      emptyCart.currentCartId = null;
      // 已经为空就别再 setData
      const cur = this.data.cartCount;
      if (cur && Object.keys(cur).length === 0 && !this.data.currentCartId) return;
      this.setData({ cartCount: {}, currentCartId: null, totalCount: 0, totalPrice: '0.00', cartItems: [] });
      return;
    }

    const cartCount = {};
    cart.cart_items.forEach(item => {
      cartCount[item.dish_id] = (cartCount[item.dish_id] || 0) + item.quantity;
    });

    // 与本地状态完全一致就 ignore，避免无意义重渲染
    if (this.cartCountEqual(this.data.cartCount, cartCount) && this.data.currentCartId === cart.id) {
      return;
    }

    const localCart = getApp().getCart(this.data.tableId);
    localCart.cartCount = { ...cartCount };
    localCart.currentCartId = cart.id;

    // 一次合并 setData
    const { allDishes, showCartPanel } = this.data;
    let totalCount = 0;
    let totalPrice = 0;
    for (const k in cartCount) {
      const c = cartCount[k];
      if (c > 0) {
        const dish = allDishes.find(d => d.id == k);
        if (dish) {
          totalCount += c;
          totalPrice += c * parseFloat(dish.price);
        }
      }
    }
    const patch = {
      cartCount,
      currentCartId: cart.id,
      totalCount,
      totalPrice: totalPrice.toFixed(2)
    };
    if (showCartPanel) {
      const items = [];
      for (const k in cartCount) {
        const c = cartCount[k];
        if (c > 0) {
          const dish = allDishes.find(d => d.id == k);
          if (dish) {
            items.push({
              id: dish.id,
              dish_name: dish.name,
              price: parseFloat(dish.price).toFixed(2),
              quantity: c,
              subtotal: (c * parseFloat(dish.price)).toFixed(2),
              image_url: dish.image_url || ''
            });
          }
        }
      }
      patch.cartItems = items;
    }
    this.setData(patch);
  },

  // 浅比较两个 cartCount 对象是否相等
  cartCountEqual(a, b) {
    if (!a && !b) return true;
    if (!a || !b) return false;
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
      if (a[k] !== b[k]) return false;
    }
    return true;
  },

  // 释放桌号资源 - 结账/取消后必须清理，避免缓存导致下次进入混乱
  releaseTableResources() {
    console.log('释放桌号资源，清理所有缓存');

    // 重置页面数据
    this.setData({
      cartCount: {},
      currentOrderId: null,
      orderStatus: null,
      totalCount: 0,
      totalPrice: '0.00',
      tableId: '',
      tableNumber: '',
      hasScannedTable: false
    });

    // 清除本地存储
    wx.removeStorageSync('savedTableId');
    wx.removeStorageSync('tableNumber');

    // 清除全局数据
    const app = getApp();
    if (app) {
      app.globalData.tableId = null;
      app.globalData.carts = {};
      app.globalData.addMoreCarts = {};
      app.globalData.addMore = false;
      if (app.globalData.userInfo) {
        app.globalData.userInfo.table_number = null;
        wx.setStorageSync('userInfo', app.globalData.userInfo);
      }
    }

    // 断开 WebSocket
    this.closeWebSocket();
  },

  async fetchTableInfo(id) {
    try {
      const table = await request({ url: `/tables/${id}`, noLoading: true });
      this.setData({ tableId: table.id, tableNumber: table.table_number });
      getApp().globalData.tableId = table.id;
      this.initWebSocket();
    } catch (err) {
      console.error('获取桌台信息失败', err);
      wx.showToast({
        title: '获取桌台信息失败',
        icon: 'none'
      });
    }
  },

  async fetchTableInfoByNumber(tableNumber) {
    try {
      // 先验证桌号是否有效
      const validation = await request({ url: `/tables/validate/${tableNumber}`, noLoading: true });
      if (!validation || !validation.valid) {
        wx.showModal({
          title: '桌号无效',
          content: validation?.message || '该桌号不存在或已被删除，请联系服务员',
          showCancel: false,
          confirmText: '我知道了'
        });
        return;
      }

      const table = await request({ url: `/tables/number/${tableNumber}`, noLoading: true });
      this.setData({ tableId: table.id, tableNumber: table.table_number, hasScannedTable: true });
      getApp().globalData.tableId = table.id;
      wx.setStorageSync('savedTableId', table.id);
      this.bindTable(tableNumber);
      this.initWebSocket();
      this.fetchCurrentCart();
    } catch (err) {
      console.error('获取桌台信息失败', err);
      wx.showToast({
        title: '获取桌台信息失败',
        icon: 'none'
      });
    }
  },

  async bindTable(tableNumber) {
    const token = wx.getStorageSync('token');
    if (!token) return;
    try {
      const result = await request({
        url: '/auth/bind-table',
        method: 'POST',
        data: { tableNumber },
        noLoading: true
      });
      const userInfo = wx.getStorageSync('userInfo');
      if (userInfo) {
        userInfo.table_number = result.tableNumber;
        wx.setStorageSync('userInfo', userInfo);
        getApp().globalData.userInfo = userInfo;
      }
    } catch (err) {
      console.error('绑定桌台失败', err);
    }
  },

  async fetchData() {
    try {
      console.log('开始获取菜品数据...');
      const categories = await request({ url: '/dishes/categories', noLoading: true });
      console.log('获取到分类:', categories);
      
      let allDishes = await request({ url: '/dishes', noLoading: true });
      console.log('获取到菜品:', allDishes);
      
      const { serverURL } = require('../../utils/request');
      allDishes = allDishes.map(dish => {
        if (dish.image_url && !dish.image_url.startsWith('http')) {
          if (dish.image_url.includes('__tmp__') || dish.image_url.includes('tmp/')) {
            dish.image_url = '';
          } else {
            dish.image_url = serverURL + (dish.image_url.startsWith('/') ? '' : '/') + dish.image_url;
          }
        }
        return dish;
      });

      const allCategory = { id: 'all', name: '全部', dish_count: allDishes.length };
      const categoriesWithAll = [allCategory, ...categories];

      this.setData({
        categories: categoriesWithAll,
        allDishes,
        currentCategory: 'all',
        currentCategoryName: '全部'
      });
      getApp().globalData.allDishes = allDishes;
      this.filterDishes();
      this.fetchCurrentCart();
    } catch (err) {
      console.error('加载数据失败', err);
      wx.showToast({
        title: '加载数据失败，请重试',
        icon: 'none'
      });
    }
  },

  async fetchCurrentCart() {
    if (!this.data.tableId || this.isFetchingOrder || this.data.isAddMore) return;
    this.isFetchingOrder = true;
    try {
      const cart = await request({
        url: `/carts/current/${this.data.tableId}`,
        noLoading: true
      });

      if (cart && cart.cart_items && cart.cart_items.length > 0) {
        const cartCount = {};
        cart.cart_items.forEach(item => {
          cartCount[item.dish_id] = (cartCount[item.dish_id] || 0) + item.quantity;
        });
        this.setData({ cartCount, currentCartId: cart.id });
        const localCart = getApp().getCart(this.data.tableId);
        localCart.cartCount = { ...cartCount };
        localCart.currentCartId = cart.id;
        this.calculateTotal();
      } else {
        this.setData({ cartCount: {}, currentCartId: null, totalCount: 0, totalPrice: '0.00' });
        const localCart = getApp().getCart(this.data.tableId);
        localCart.cartCount = {};
        localCart.currentCartId = null;
      }
    } catch (err) {
      console.error('获取当前购物车失败', err);
    } finally {
      this.isFetchingOrder = false;
    }
  },

  async fetchCurrentOrderForAddMore() {
    if (!this.data.tableId || this.isFetchingOrder) return;
    this.isFetchingOrder = true;
    try {
      const order = await request({ 
        url: `/orders/current/${this.data.tableId}`,
        noLoading: true 
      });
      if (order && (order.status === 'submitted' || order.status === 'printed' || order.status === 'unpaid')) {
        const addMoreCart = getApp().getAddMoreCart(this.data.tableId);
        addMoreCart.currentOrderId = order.id;
        addMoreCart.orderStatus = order.status;
        addMoreCart.cartCount = {};
        this.setData({ currentOrderId: order.id, orderStatus: order.status, cartCount: {} });
      }
    } catch (err) {
      console.error('获取加餐订单失败', err);
    } finally {
      this.isFetchingOrder = false;
    }
  },

  startScan() {
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ['qrCode', 'barCode', 'wxCode'],
      success: (res) => {
        console.log('扫码结果:', res);
        let tableNumber = '';
        
        // 优先从 path 的 scene 参数中提取桌码号（小程序码扫码）
        if (res.path) {
          const queryStr = res.path.split('?')[1];
          if (queryStr) {
            const params = queryStr.split('&');
            for (let param of params) {
              const [key, value] = param.split('=');
              if (key === 'scene' && value) {
                tableNumber = decodeURIComponent(value).trim();
                break;
              }
            }
          }
        }
        
        // 如果 path 中没有，尝试从 result 中解析
        if (!tableNumber && res.result) {
          // 检查是否是微信 URL（开发者工具限制）
          if (res.result.includes('mp.weixin.qq.com') || res.result.includes('weixin.qq.com')) {
            wx.showModal({
              title: '开发者工具限制',
              content: '在开发者工具中无法正确解析小程序码。请使用真机测试，或使用"通过二维码编译"功能。',
              showCancel: false
            });
            return;
          }
          
          if (res.result.includes('tableNumber=')) {
            tableNumber = res.result.split('tableNumber=')[1].split('&')[0];
          } else if (res.result.includes('table_id=')) {
            const tableId = res.result.split('table_id=')[1].split('&')[0];
            getApp().globalData.tableId = tableId;
            this.setData({ tableId });
            this.fetchTableInfo(tableId);
            this.fetchCurrentCart();
            return;
          } else {
            // 纯数字或桌台编号
            tableNumber = res.result;
          }
        }
        
        if (tableNumber) {
          this.fetchTableInfoByNumber(tableNumber);
        } else {
          wx.showToast({
            title: '未能识别桌码',
            icon: 'none'
          });
        }
      },
      fail: (err) => {
        if (err.errMsg !== 'scanCode:fail cancel') {
          wx.showToast({
            title: '扫码失败',
            icon: 'none'
          });
        }
      }
    });
  },

  switchCategory(e) {
    const id = e.currentTarget.dataset.id;
    const cat = this.data.categories.find(c => c.id == id);
    this.setData({
      currentCategory: id,
      currentCategoryName: cat?.name
    });
    this.filterDishes();
  },

  filterDishes() {
    const { allDishes, currentCategory } = this.data;
    const dishes = currentCategory === 'all' ? allDishes : allDishes.filter(d => d.category_id == currentCategory);
    this.setData({ dishes });
  },

  updateCart(e) {
    if (!this.data.hasScannedTable) {
      if (this.modal) {
        this.modal.show({
          title: '请先扫码',
          content: '扫描桌台上的二维码后即可开始点餐',
          confirmText: '去扫码',
          cancelText: '取消'
        }).then(confirmed => {
          if (confirmed) this.startScan();
        });
      } else {
        wx.showModal({
          title: '提示',
          content: '请先扫描桌码再点餐',
          showCancel: false,
          confirmText: '去扫码',
          success: (res) => { if (res.confirm) this.startScan(); }
        });
      }
      return;
    }

    if (!getApp().globalData.userInfo) {
      if (this.modal) {
        this.modal.show({
          title: '请先登录',
          content: '登录后即可点餐下单',
          confirmText: '去登录',
          cancelText: '取消'
        }).then(confirmed => {
          if (confirmed) wx.switchTab({ url: '/pages/me/me' });
        });
      } else {
        wx.showModal({
          title: '提示',
          content: '请先登录后再点餐',
          confirmText: '去登录',
          cancelText: '取消',
          success: (res) => { if (res.confirm) wx.switchTab({ url: '/pages/me/me' }); }
        });
      }
      return;
    }

    const { id, type } = e.currentTarget.dataset;
    const { cartCount, allDishes, isAddMore, tableId, showCartPanel } = this.data;
    const count = cartCount[id] || 0;
    const nextCount = type === 'plus' ? count + 1 : Math.max(0, count - 1);

    // ① 计算下一帧的 cartCount（不可变拷贝，避免 setData diff 失效）
    const nextCartCount = { ...cartCount };
    if (nextCount === 0) {
      delete nextCartCount[id];
    } else {
      nextCartCount[id] = nextCount;
    }

    // ② 同步算合计（避免再走一次 setData）
    let totalCount = 0;
    let totalPrice = 0;
    for (const k in nextCartCount) {
      const c = nextCartCount[k];
      if (c > 0) {
        const dish = allDishes.find(d => d.id == k);
        if (dish) {
          totalCount += c;
          totalPrice += c * parseFloat(dish.price);
        }
      }
    }

    // ③ 弹窗打开时同步 cartItems，关闭时不算
    let patch = {
      cartCount: nextCartCount,
      totalCount,
      totalPrice: totalPrice.toFixed(2)
    };
    if (showCartPanel) {
      const items = [];
      for (const k in nextCartCount) {
        const c = nextCartCount[k];
        if (c > 0) {
          const dish = allDishes.find(d => d.id == k);
          if (dish) {
            items.push({
              id: dish.id,
              dish_name: dish.name,
              price: parseFloat(dish.price).toFixed(2),
              quantity: c,
              subtotal: (c * parseFloat(dish.price)).toFixed(2),
              image_url: dish.image_url || ''
            });
          }
        }
      }
      patch.cartItems = items;
    }

    // ④ 一次 setData 完成所有 UI 更新
    this.setData(patch);

    // ⑤ 写入全局 cart（同步内存，不触发渲染）
    const cart = isAddMore ? getApp().getAddMoreCart(tableId) : getApp().getCart(tableId);
    cart.cartCount = { ...nextCartCount };

    // ⑥ 防抖同步到后端，连续点击只发最后一次
    this.scheduleSyncCart();
  },

  calculateTotal() {
    const { cartCount, allDishes } = this.data;
    let totalCount = 0;
    let totalPrice = 0;

    for (const id in cartCount) {
      const count = cartCount[id];
      if (count > 0) {
        const dish = allDishes.find(d => d.id == id);
        if (dish) {
          totalCount += count;
          totalPrice += count * parseFloat(dish.price);
        }
      }
    }

    this.setData({
      totalCount,
      totalPrice: totalPrice.toFixed(2)
    });

    // 弹窗打开时同步刷新 cartItems
    if (this.data.showCartPanel) {
      this.refreshCartItems();
    }
  },

  // 防抖触发同步购物车，连续点击只发最后一次
  scheduleSyncCart() {
    if (this._syncTimer) {
      clearTimeout(this._syncTimer);
    }
    this._syncTimer = setTimeout(() => {
      this._syncTimer = null;
      this.syncCartToBackend();
    }, 300);
  },

  async syncCartToBackend() {
    const { cartCount, allDishes, tableId, currentCartId, currentOrderId, isAddMore } = this.data;
    if (!tableId) return;
    // 标记本次本地同步时间，handleCartUpdate 在窗口内会忽略 ws 回声
    this._lastSyncAt = Date.now();

    const items = [];
    const userInfo = getApp().globalData.userInfo;
    
    for (const id in cartCount) {
      const count = cartCount[id];
      if (count > 0) {
        const dish = allDishes.find(d => d.id == id);
        if (dish) {
          items.push({
            dish_id: dish.id,
            dish_name: dish.name,
            price: parseFloat(dish.price),
            quantity: count,
            added_by_user_id: userInfo?.id,
            added_by_nickname: userInfo?.nickname || '未知用户'
          });
        }
      }
    }

    if (items.length === 0) {
      if (isAddMore) {
        getApp().clearAddMoreCart(this.data.tableId);
      } else if (currentCartId) {
        await request({
          url: `/carts/${currentCartId}`,
          method: 'DELETE',
          noLoading: true
        });
        getApp().clearCart(this.data.tableId);
      }
      // 仅在状态实际变化时 setData
      const cur = this.data.cartCount;
      const isAlreadyEmpty = cur && Object.keys(cur).length === 0
        && this.data.currentCartId === null
        && this.data.currentOrderId === null
        && this.data.totalCount === 0;
      if (!isAlreadyEmpty) {
        this.setData({ cartCount: {}, currentCartId: null, currentOrderId: null, orderStatus: null, totalCount: 0, totalPrice: '0.00', cartItems: [] });
      }
      return;
    }

    try {
      const { orderStatus } = this.data;
      if (isAddMore) {
        if (currentOrderId && (orderStatus === 'submitted' || orderStatus === 'printed')) {
          await request({
            url: `/orders/${currentOrderId}/sync-add-more`,
            method: 'POST',
            data: { items },
            noLoading: true
          });
        } else {
          const result = await request({
            url: '/orders',
            method: 'POST',
            data: {
              table_id: parseInt(tableId),
              items: items,
              user_id: getApp().globalData.userInfo?.id
            },
            noLoading: true
          });
          const addMoreCart = getApp().getAddMoreCart(this.data.tableId);
          addMoreCart.currentOrderId = result.id;
          addMoreCart.orderStatus = result.status;
          this.setData({ currentOrderId: result.id, orderStatus: result.status });
        }
      } else {
        const result = await request({
          url: '/carts/sync',
          method: 'POST',
          data: {
            table_id: parseInt(tableId),
            items: items,
            user_id: getApp().globalData.userInfo?.id
          },
          noLoading: true
        });
        const cart = getApp().getCart(this.data.tableId);
        cart.currentCartId = result?.id || null;
        const nextCartId = result?.id || null;
        // 仅在变化时 setData，避免无意义渲染
        if (this.data.currentCartId !== nextCartId) {
          this.setData({ currentCartId: nextCartId });
        }
      }
    } catch (err) {
      console.error('同步购物车失败', err);
    }
  },

  goToCart() {
    this.refreshCartItems();
    this.setData({ showCartPanel: true });
  },

  closeCartPanel() {
    this.setData({ showCartPanel: false });
  },

  preventClose() {},

  // 用 cartCount + allDishes 重算 cartItems（带图片）给弹窗渲染
  refreshCartItems() {
    const { cartCount, allDishes } = this.data;
    const items = [];
    for (const id in cartCount) {
      const count = cartCount[id];
      if (count > 0) {
        const dish = allDishes.find(d => d.id == id);
        if (dish) {
          items.push({
            id: dish.id,
            dish_name: dish.name,
            price: parseFloat(dish.price).toFixed(2),
            quantity: count,
            subtotal: (count * parseFloat(dish.price)).toFixed(2),
            image_url: dish.image_url || ''
          });
        }
      }
    }
    this.setData({ cartItems: items });
  },

  // 弹窗里的清空
  clearCart() {
    if (this.data.totalCount === 0) return;
    const doClear = () => {
      if (this.data.isAddMore) {
        getApp().clearAddMoreCart(this.data.tableId);
      } else {
        getApp().clearCart(this.data.tableId);
      }
      this.setData({ cartCount: {}, cartItems: [], totalCount: 0, totalPrice: '0.00' });
      this.syncCartToBackend();
    };
    if (this.modal) {
      this.modal.show({
        title: '清空购物车',
        content: '确定要清空购物车吗？',
        confirmText: '清空',
        cancelText: '取消',
        type: 'danger'
      }).then(confirmed => { if (confirmed) doClear(); });
    } else {
      wx.showModal({
        title: '提示',
        content: '确定要清空购物车吗？',
        success: (res) => { if (res.confirm) doClear(); }
      });
    }
  },

  goToConfirm() {
    if (this.data.isAddMore) {
      const content = `共${this.data.totalCount}件菜品，合计¥${this.data.totalPrice}，确认提交？`;
      if (this.modal) {
        this.modal.show({
          title: '确认提交加餐',
          content,
          confirmText: '提交',
          cancelText: '再想想'
        }).then(confirmed => { if (confirmed) this.submitAddMore(); });
      } else {
        wx.showModal({
          title: '确认提交加餐',
          content,
          success: (res) => { if (res.confirm) this.submitAddMore(); }
        });
      }
    } else {
      this.setData({ showConfirmSheet: true });
    }
  },

  onConfirmSheetClose() {
    this.setData({ showConfirmSheet: false });
  },

  onConfirmSubmitted(e) {
    const orderId = e.detail && e.detail.orderId;
    // 关 confirm-sheet 后，等动画结束再开 detail-sheet
    if (orderId) {
      setTimeout(() => {
        this.openDetailSheet(orderId);
      }, 240);
    }
  },

  // ====== 订单详情弹窗（替代 pages/order/detail）======
  openDetailSheet(orderId) {
    if (!orderId) return;
    if (this.data.showDetailSheet && this.data.detailOrderId === String(orderId)) {
      return;
    }
    this.setData({
      showDetailSheet: true,
      detailOrderId: String(orderId)
    });
  },

  onDetailSheetClose() {
    this.setData({ showDetailSheet: false, detailOrderId: '' });
  },

  // detail-sheet 通知：订单已结账/取消，桌号已释放
  onDetailTableReleased() {
    // 同步清理 order 页面状态，避免回到 order 页时还显示旧桌号/购物车
    this.setData({
      tableId: '',
      tableNumber: '',
      hasScannedTable: false,
      cartCount: {},
      cartItems: [],
      totalCount: 0,
      totalPrice: '0.00',
      currentCartId: null,
      currentOrderId: null,
      orderStatus: null,
      isAddMore: false
    });
    // 关掉 ws 订阅，等用户重新扫码再连
    this.closeWebSocket();
  },

  async submitAddMore() {
    wx.showLoading({ title: '提交中...' });
    try {
      const { cartCount, allDishes, tableId } = this.data;
      const items = [];
      const userInfo = getApp().globalData.userInfo;
      for (const id in cartCount) {
        const count = cartCount[id];
        if (count > 0) {
          const dish = allDishes.find(d => d.id == id);
          if (dish) {
            items.push({
              dish_id: dish.id,
              dish_name: dish.name,
              price: parseFloat(dish.price),
              quantity: count,
              added_by_user_id: userInfo?.id,
              added_by_nickname: userInfo?.nickname || '未知用户'
            });
          }
        }
      }

      const result = await request({
        url: '/orders',
        method: 'POST',
        data: {
          table_id: parseInt(tableId),
          items: items,
          user_id: userInfo?.id
        }
      });

      getApp().clearAddMoreCart(this.data.tableId);
      this.setData({ cartCount: {}, currentOrderId: null, orderStatus: null, totalCount: 0, totalPrice: '0.00', isAddMore: false });

      wx.hideLoading();
      wx.showToast({ title: '加餐已提交', icon: 'success' });

      setTimeout(() => {
        this.openDetailSheet(result.id);
      }, 1500);
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '提交失败', icon: 'none' });
      console.error('提交加餐失败', err);
    }
  },

  // ===== 数量输入弹窗 =====
  onCountTap(e) {
    const { id, count } = e.currentTarget.dataset;
    const dish = this.data.allDishes.find(d => d.id == id);
    this.setData({
      showQtyModal: true,
      editDishId: id,
      editDishName: dish?.name || '',
      editDishCount: count
    });
  },

  closeQtyModal() {
    this.setData({ showQtyModal: false, editDishId: null });
  },

  preventClose() {},

  onQtyInput(e) {
    const val = parseInt(e.detail.value);
    this.setData({ editDishCount: isNaN(val) ? 0 : Math.max(0, val) });
  },

  onQtyQuickSet(e) {
    const val = parseInt(e.currentTarget.dataset.val);
    this.setData({ editDishCount: isNaN(val) ? 0 : Math.max(0, val) });
  },

  confirmQty() {
    const { editDishId, editDishCount, cartCount, isAddMore } = this.data;
    if (editDishId === null) return;

    if (editDishCount <= 0) {
      delete cartCount[editDishId];
    } else {
      cartCount[editDishId] = editDishCount;
    }

    this.setData({ cartCount, showQtyModal: false, editDishId: null });
    const cart = isAddMore ? getApp().getAddMoreCart(this.data.tableId) : getApp().getCart(this.data.tableId);
    cart.cartCount = { ...cartCount };
    this.calculateTotal();
    this.syncCartToBackend();
  },

  // ====== "我的"弹窗（替代 wx.switchTab → me 页）======
  openMeSheet() {
    if (this.data.showMeSheet) return;
    // 不隐藏 TabBar：sheet 给底部 TabBar 留空间，用户能直接点"浏览"切回
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tabBar && tabBar.setSelected) {
      tabBar.setSelected(1); // "我的"高亮
    }
    this.setData({ showMeSheet: true });
  },

  onMeSheetClose() {
    this.setData({ showMeSheet: false });
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tabBar && tabBar.setSelected) {
      tabBar.setSelected(0); // 恢复"浏览"高亮
    }
  },

  // me-sheet → orders-sheet 的"再来一单"已写入购物车，回到 order 页打开 confirm-sheet
  onMeReorder(e) {
    const tableId = (e.detail && e.detail.tableId) || this.data.tableId;
    if (tableId && this.data.tableId !== String(tableId)) {
      this.setData({ tableId: String(tableId) });
    }
    // me-sheet 已自行关闭，等动画结束再开 confirm-sheet（避免叠层冲突）
    setTimeout(() => {
      this.setData({ showConfirmSheet: true });
    }, 50);
  },

  // me-sheet → orders-sheet 的"查看详情"，me-sheet 仍保留，detail-sheet 叠在最上层
  onMeDetail(e) {
    const orderId = e.detail && e.detail.orderId;
    if (orderId) {
      this.openDetailSheet(orderId);
    }
  },

  // 拦截系统返回键 / 手势：关闭 detail-sheet / confirm-sheet / me-sheet 而不是退出 order 页
  onBackPress() {
    if (this.data.showDetailSheet) {
      this.onDetailSheetClose();
      return true;
    }
    if (this.data.showConfirmSheet) {
      this.onConfirmSheetClose();
      return true;
    }
    if (this.data.showMeSheet) {
      this.onMeSheetClose();
      return true; // 阻止默认返回
    }
    return false;
  }
})
