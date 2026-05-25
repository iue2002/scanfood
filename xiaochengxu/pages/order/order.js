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
    // 外带模式：用户从右上角"打包带走"进入；不需扫码 / 不走共享桌台 cart / 不调 ws 同步
    isTakeaway: false,
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
    detailOrderId: '',
    // 锁定模式：检测到未付款订单时强制完成（隐藏返回 + 盖住 TabBar）
    detailLocked: false,
    // me-sheet 内部叠开了订单列表（订单列表是非"我的/浏览"sheet，要隐藏 TabBar）
    _meOrdersOpen: false,
    // === 自定义导航栏：状态栏高度（custom 模式必需） ===
    statusBarHeight: 0,
    // === 自定义导航栏：店铺品牌信息（启动时 app.js 已预加载到 globalData，这里同步过来） ===
    storeInfo: null
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
    // === 自定义导航栏：读取手机状态栏高度（用于占位） ===
    try {
      const sysInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.setData({ statusBarHeight: sysInfo.statusBarHeight || 20 });
    } catch (e) {
      this.setData({ statusBarHeight: 20 });
    }

    // === 自定义导航栏：从 globalData 同步店铺信息（app.js 启动时已预加载） ===
    this.syncStoreInfo();

    let tableNumber = null;
    let rawTableId = options.tableId;

    if (options.scene) {
      // scene参数是URL编码的，需要解码
      // 微信扫码进入时，scene就是桌台编号（如 "01"）
      try {
        const scene = decodeURIComponent(options.scene);
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
        return;
      }
      const order = await request({ url: '/orders/my-active', noLoading: true });
      if (order && order.id) {
        // 自动检测：锁定模式（强制用户完成订单）
        this.openDetailSheet(order.id, true);
      }
    } catch (err) {
      console.log('没有未完成的订单', err);
    }
  },

  async checkActiveOrder() {
    try {
      const token = wx.getStorageSync('token');
      if (!token) {
        // 未登录时也释放桌号资源
        if (this.data.tableId) {
          this.releaseTableResources();
        }
        return false;
      }
      const order = await request({ url: '/orders/my-active', noLoading: true });
      if (order && order.id) {
        // 有未完成订单：锁定模式打开 detail-sheet（强制用户完成订单）
        this.openDetailSheet(order.id, true);
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

    // 同步店铺信息（app.js 异步刷新的最新店名/头像可能在 onShow 时才到位）
    this.syncStoreInfo();

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

    // onShow 时若有桌号但 ws 已关（挂机/onHide 关掉的）→ 重连
    // initWebSocket 内部有"已连/连中跳过"保护，多次调用安全
    if (this.data.tableId && !this._wsConnected && !this._wsConnecting) {
      this.initWebSocket();
    }

    // 异步检查未付款订单（已节流），不阻塞页面显示
    if (!isSecondShow) {
      this.checkActiveOrderAsync();
    }
  },

  async onPullDownRefresh() {
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
    // 页面卸载兜底：关闭退出确认拦截，避免泄漏到其它页面
    this.disableExitGuard();
  },

  // ====== 自定义导航栏：店铺品牌信息同步（参考 detail-sheet / orders-sheet 的做法） ======
  syncStoreInfo() {
    try {
      const app = getApp();
      const storeInfo = app && app.globalData && app.globalData.storeInfo;
      if (storeInfo && storeInfo.store_name) {
        this.setData({ storeInfo });
      }
    } catch (e) {
      console.warn('[order] syncStoreInfo failed', e);
    }
  },

  // ====== 退出确认拦截（防止用户误按手机系统返回键直接退出小程序） ======
  // 调用时机：扫桌成功 + 购物车有内容时启用；提交订单 / 释放桌台 / 主动清空时关闭
  // 微信官方 API：仅真机生效（开发者工具不弹），基础库 ≥ 2.10.0
  // 文档：https://developers.weixin.qq.com/miniprogram/dev/api/route/wx.enableAlertBeforeUnload.html
  _exitGuardEnabled: false,
  enableExitGuard(message) {
    if (this._exitGuardEnabled) return;
    if (!wx.enableAlertBeforeUnload) return; // 老基础库无此 API，静默跳过
    try {
      wx.enableAlertBeforeUnload({
        message: message || '订单未提交，确定要离开吗？',
      });
      this._exitGuardEnabled = true;
    } catch (e) {
      console.warn('[exit-guard] 启用退出确认失败', e);
    }
  },
  disableExitGuard() {
    if (!this._exitGuardEnabled) return;
    if (!wx.disableAlertBeforeUnload) return;
    try {
      wx.disableAlertBeforeUnload();
      this._exitGuardEnabled = false;
    } catch (e) {
      console.warn('[exit-guard] 关闭退出确认失败', e);
    }
  },
  // 根据当前状态自动决定开/关退出确认（购物车有菜 + 已扫桌就拦截）
  syncExitGuard() {
    const hasCart = this.data.totalCount > 0;
    const hasTable = !!this.data.tableId || this.data.isTakeaway;
    if (hasCart && hasTable) {
      this.enableExitGuard();
    } else {
      this.disableExitGuard();
    }
  },

  // 页面隐藏（切到其他小程序 / 锁屏）：暂停 ws 避免后台重连风暴
  // 不动 cart 状态，下次 onShow 时会自动恢复
  onHide() {
    this.closeWebSocket();
    if (this._syncTimer) {
      clearTimeout(this._syncTimer);
      this._syncTimer = null;
    }
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
      multiple: true, // 允许多 socket 共存，避免与 detail-sheet 的订单 ws 互相覆盖
    });

    this.ws.onOpen(() => {
      console.log('WebSocket 已打开，订阅桌台:', this.data.tableId);
      this._wsConnected = true;
      this._wsConnecting = false;
      this._reconnectDelay = 1000;
      this._wsReconnectCount = 0; // 连接成功 → 重置失败计数
      this.ws.send({
        data: JSON.stringify({
          event: 'subscribeTable',
          data: { tableId: this.data.tableId }
        })
      });
      // 启动心跳：每 25 秒主动发 ping，防止 cpolar/nginx 等反代 60s 空闲超时切连接
      this._startHeartbeat();
      // 重连后补拉一次最新订单状态：避免断线期间错过 orderStatusChanged 导致 UI 不刷新
      // 关键场景：商家结账时 ws 刚好断开，重连后小程序看到的还是旧状态
      try { this.fetchCurrentCart(); } catch (e) { /* ignore */ }
    });

    this.ws.onMessage((res) => {
      try {
        const message = JSON.parse(res.data);

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
      this._stopHeartbeat();

      // 已结账或取消的订单不再重连
      const orderStatus = (getApp().getCart(this.data.tableId) || {}).orderStatus;
      if (orderStatus === 'settled' || orderStatus === 'cancelled') return;
      // 没桌号了也不重连（用户已离开桌台）
      if (!this.data.tableId) return;

      // 重连次数上限：避免挂机后无限重连消耗资源、阻塞主线程
      this._wsReconnectCount = (this._wsReconnectCount || 0) + 1;
      const MAX_RECONNECT = 5;
      if (this._wsReconnectCount > MAX_RECONNECT) {
        console.log(`[WS] 已达最大重连次数 ${MAX_RECONNECT}，停止重连，等待用户操作`);
        return;
      }

      // 指数退避 + 抖动（避免多客户端同步重连）
      const delay = (this._reconnectDelay || 1000) + Math.floor(Math.random() * 500);
      this._reconnectDelay = Math.min((this._reconnectDelay || 1000) * 2, 30000);
      console.log(`[WS] ${delay}ms 后尝试重连 (${this._wsReconnectCount}/${MAX_RECONNECT})`);
      this._reconnectTimer = setTimeout(() => {
        this._reconnectTimer = null;
        this.initWebSocket();
      }, delay);
    });
  },

  closeWebSocket() {
    this._wsConnected = false;
    this._wsConnecting = false;
    this._wsReconnectCount = 0;
    this._reconnectDelay = 1000;
    this._stopHeartbeat();
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

  // ====== WS 心跳：每 25 秒发一次 ping，让 cpolar/nginx 不要切空闲连接 ======
  // 反代默认空闲超时通常 ≥ 60s，25s 心跳留 2x 安全余量
  _startHeartbeat() {
    this._stopHeartbeat();
    this._heartbeatTimer = setInterval(() => {
      if (this._wsConnected && this.ws) {
        try {
          this.ws.send({ data: JSON.stringify({ event: 'ping', data: { ts: Date.now() } }) });
        } catch (e) { /* ignore */ }
      }
    }, 25000);
  },
  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  },

  handleOrderUpdate(order) {
    if (order && (order.status === 'submitted' || order.status === 'printed' || order.status === 'unpaid')) {
      if (this.data.isAddMore) {
        return;
      }
      // ws 推送的未付款订单：锁定模式
      this.openDetailSheet(order.id, true);
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
      const categories = await request({ url: '/dishes/categories', noLoading: true });
      let allDishes = await request({ url: '/dishes', noLoading: true });

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
    // 进入扫码：自动退出外带模式（因为扫码意味着用户回到了堂食流程）
    if (this.data.isTakeaway) {
      this.setData({ isTakeaway: false, cartCount: {}, cartItems: [], totalCount: 0, totalPrice: '0.00' });
    }
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ['qrCode', 'barCode', 'wxCode'],
      success: (res) => {
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
    // 外带模式：跳过扫码桌号检查（外带不依赖桌号）
    if (!this.data.hasScannedTable && !this.data.isTakeaway) {
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
    let nextCount = type === 'plus' ? count + 1 : Math.max(0, count - 1);

    // 首次添加该菜品时，如果设置了最低购买数量，则自动使用最低数量
    if (type === 'plus' && count === 0) {
      const dish = allDishes.find(d => d.id == id);
      if (dish) {
        const minQty = Number(dish.min_quantity || 1);
        if (minQty > 1) {
          nextCount = minQty;
        }
      }
    }

    // 减少该菜品时，如果当前数量不高于最低购买数量，则直接清空
    if (type === 'minus' && count > 0 && nextCount > 0) {
      const dish = allDishes.find(d => d.id == id);
      if (dish) {
        const minQty = Number(dish.min_quantity || 1);
        if (minQty > 1 && count <= minQty) {
          nextCount = 0;
        }
      }
    }

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

    // 外带模式：不写桌台共享 cart、不调 ws 同步（外带是独立订单）
    if (this.data.isTakeaway) {
      return;
    }

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

    // 购物车数量变化 → 自动同步退出确认拦截开/关
    this.syncExitGuard();
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

  // ====== 外带（打包带走）入口 ======
  // 进入外带模式：清掉当前桌台 cart 数据（避免堂食 cart 残留），切换到本地独立 cart
  goTakeaway() {
    if (this.data.isTakeaway) {
      // 已在外带模式：直接走提交
      this.submitTakeawayOrder();
      return;
    }

    const enterTakeaway = () => {
      // 切换到外带模式：清空当前菜品计数、清掉桌号显示，但不动 globalData 的桌台 cart（堂食用户回来还能用）
      this.setData({
        isTakeaway: true,
        cartCount: {},
        cartItems: [],
        totalCount: 0,
        totalPrice: '0.00'
      });
      wx.showToast({ title: '已进入外带模式，请选菜后提交', icon: 'none' });
    };

    if (this.data.totalCount > 0 && !this.data.isAddMore) {
      // 当前桌台有未结账菜品：提示用户切换
      if (this.modal) {
        this.modal.show({
          title: '切换到外带',
          content: '将清空当前桌台购物车进入外带模式，已下的订单不受影响。继续？',
          confirmText: '继续',
          cancelText: '取消'
        }).then(confirmed => { if (confirmed) enterTakeaway(); });
      } else {
        wx.showModal({
          title: '切换到外带',
          content: '将清空当前桌台购物车进入外带模式，已下的订单不受影响。继续？',
          success: (res) => { if (res.confirm) enterTakeaway(); }
        });
      }
      return;
    }
    enterTakeaway();
  },

  // 退出外带模式（提交后或用户重新扫码时）
  exitTakeaway() {
    this.setData({
      isTakeaway: false,
      cartCount: {},
      cartItems: [],
      totalCount: 0,
      totalPrice: '0.00'
    });
  },

  async submitTakeawayOrder() {
    if (this._submittingTakeaway) return;
    if (!this.data.totalCount || this.data.totalCount === 0) {
      wx.showToast({ title: '请先选择菜品', icon: 'none' });
      return;
    }
    const userInfo = getApp().globalData.userInfo;
    if (!userInfo) {
      if (this.modal) {
        this.modal.show({
          title: '请先登录',
          content: '登录后即可下单外带',
          confirmText: '去登录',
          cancelText: '取消'
        }).then(confirmed => { if (confirmed) this.openMeSheet(); });
      } else {
        wx.showModal({
          title: '请先登录',
          content: '登录后即可下单外带',
          success: (res) => { if (res.confirm) this.openMeSheet(); }
        });
      }
      return;
    }

    const content = `共${this.data.totalCount}件菜品，合计¥${this.data.totalPrice}，确认提交外带订单？`;
    const proceed = () => this._doSubmitTakeaway();
    if (this.modal) {
      this.modal.show({
        title: '确认外带订单',
        content,
        confirmText: '提交',
        cancelText: '再看看'
      }).then(confirmed => { if (confirmed) proceed(); });
    } else {
      wx.showModal({
        title: '确认外带订单',
        content,
        success: (res) => { if (res.confirm) proceed(); }
      });
    }
  },

  async _doSubmitTakeaway() {
    this._submittingTakeaway = true;
    wx.showLoading({ title: '提交中...' });
    try {
      const { cartCount, allDishes } = this.data;
      const userInfo = getApp().globalData.userInfo;
      const items = [];
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

      // 客户端预校验：必选菜品（提前拦下，避免空跑请求并给出引导）
      const missingRequired = this._checkMissingRequired(items, allDishes);
      if (missingRequired) {
        wx.hideLoading();
        this._submittingTakeaway = false;
        wx.showModal({
          title: '请先点必选菜品',
          content: missingRequired.map(m => '· ' + m.name).join('\n'),
          confirmText: '知道了',
          showCancel: false
        });
        return;
      }

      const result = await request({
        url: '/orders',
        method: 'POST',
        data: {
          order_type: 'takeaway',
          items,
          user_id: userInfo?.id
        }
      });

      wx.hideLoading();
      wx.showToast({ title: '外带订单已提交', icon: 'success' });
      // 退出外带模式 + 打开详情（锁定模式直到付款 / 取消）
      this.exitTakeaway();
      setTimeout(() => {
        this.openDetailSheet(result.id, true);
      }, 600);
    } catch (err) {
      wx.hideLoading();
      console.error('提交外带订单失败', err);
      // 后端校验失败（兜底提示，正常情况下客户端已有预校验）
      const data = err && (err.data || err);
      const code = data && data.code;
      if (code === 'REQUIRED_DISH_MISSING') {
        const missing = (data.missing || []).map(m => '· ' + m.name).join('\n');
        wx.showModal({
          title: '请先点必选菜品',
          content: missing || '订单缺少必选菜品',
          confirmText: '知道了',
          showCancel: false
        });
      } else if (code === 'MIN_QUANTITY_NOT_MET') {
        const detail = (data.violations || [])
          .map(v => v.name + '（至少 ' + v.required + ' 份，当前 ' + v.actual + ' 份）')
          .join('\n');
        wx.showModal({
          title: '部分菜品数量不够',
          content: detail,
          confirmText: '知道了',
          showCancel: false
        });
      } else {
        wx.showToast({ title: '提交失败', icon: 'none' });
      }
    } finally {
      this._submittingTakeaway = false;
    }
  },

  /**
   * 检查必选菜品是否缺失（客户端预校验
   * 返回缺少的必选菜品列表，如果没有缺少则返回 null
   */
  _checkMissingRequired(items, allDishes) {
    const orderDishIdSet = new Set(items.map(it => it.dish_id));
    const required = allDishes.filter(d =>
      d && d.is_required && d.status === 'available'
    );
    const missing = required.filter(d => !orderDishIdSet.has(d.id));
    return missing.length > 0 ? missing : null;
  },

  goToConfirm() {
    // 外带模式：走外带提交流程
    if (this.data.isTakeaway) {
      this.submitTakeawayOrder();
      return;
    }
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
      this._updateTabBarVisibility();
    }
  },

  onConfirmSheetClose() {
    this.setData({ showConfirmSheet: false });
    this._updateTabBarVisibility();
  },

  onConfirmSubmitted(e) {
    const orderId = e.detail && e.detail.orderId;
    // 关 confirm-sheet 后，等动画结束再开 detail-sheet（锁定模式：刚下单未结账，强制完成）
    if (orderId) {
      setTimeout(() => {
        this.openDetailSheet(orderId, true);
      }, 240);
    }
  },

  // ====== 订单详情弹窗（替代 pages/order/detail）======
  // locked=true：锁定模式，禁止关闭，强制用户完成订单（自动检测 / ws 推送 / 刚下单时用）
  //   - z-index=1500 完全盖住 TabBar 和其他 sheet
  //   - 关闭其他 sheet 避免栈层混乱
  // locked=false：普通模式，叠在 orders-sheet/me-sheet 之上（栈式）
  //   - 关闭 detail 后下层 sheet 自动显露，保留原滚动位置和状态
  openDetailSheet(orderId, locked = false) {
    if (!orderId) return;
    if (this.data.showDetailSheet && this.data.detailOrderId === String(orderId)) {
      // 已经打开同一订单：仅升级锁定状态（不能从锁→解，只能解→锁或同级）
      if (locked && !this.data.detailLocked) {
        this.setData({ detailLocked: true });
      }
      return;
    }
    const patch = {
      showDetailSheet: true,
      detailOrderId: String(orderId),
      detailLocked: !!locked
    };
    // 锁定模式才关其他 sheet（避免栈层混乱）；非锁定模式保留下层 sheet 实现栈式返回
    if (locked) {
      patch.showMeSheet = false;
      patch.showConfirmSheet = false;
    }
    this.setData(patch);
    this._updateTabBarVisibility();
  },

  onDetailSheetClose() {
    // detail-sheet 关闭：detail-sheet z-index=900，关闭后下层 orders-sheet (z=800) / me-sheet (z=800)
    // / confirm-sheet (z=850) 会自动显露（栈式渲染，保留滚动位置和状态）
    this.setData({ showDetailSheet: false, detailOrderId: '', detailLocked: false });
    this._updateTabBarVisibility();
  },

  // 订单结账/取消，detail-sheet 通知解锁（即使在锁定模式也允许关闭了）
  onDetailUnlock() {
    this.setData({ detailLocked: false });
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
        this.openDetailSheet(result.id, true);
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
  // 统一管理 TabBar 显隐：除了"我的"和"浏览"两个 sheet，其他 sheet 都隐藏 TabBar
  // - showMeSheet 单独打开：显示 TabBar（"我的"是 TabBar 页）
  // - 任何叠加层（confirm / detail / me 内嵌的订单列表）：隐藏 TabBar
  _updateTabBarVisibility() {
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (!tabBar || !tabBar.setHidden) return;
    const shouldHide =
      this.data.showConfirmSheet ||
      this.data.showDetailSheet ||
      this.data._meOrdersOpen;
    tabBar.setHidden(!!shouldHide);
  },

  openMeSheet() {
    // 不隐藏 TabBar：sheet 给底部 TabBar 留空间，用户能直接点"浏览"切回
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tabBar && tabBar.setSelected) {
      tabBar.setSelected(1); // "我的"高亮
    }
    // 已经打开了：直接调子组件 reopen 强制重新加载/动画（防止某次状态残留导致点不开）
    if (this.data.showMeSheet) {
      const meSheet = this.selectComponent('#meSheet');
      if (meSheet && typeof meSheet.reopen === 'function') {
        meSheet.reopen();
      }
      return;
    }
    this.setData({ showMeSheet: true });
    this._updateTabBarVisibility();
  },

  onMeSheetClose() {
    this.setData({ showMeSheet: false, _meOrdersOpen: false });
    this._updateTabBarVisibility();
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tabBar && tabBar.setSelected) {
      tabBar.setSelected(0); // 恢复"浏览"高亮
    }
  },

  // me-sheet → orders-sheet 的"再来一单"已写入购物车，回到 order 页打开 confirm-sheet
  // 注意触发顺序：父级先收到 'close'（已把 showMeSheet 置 false），再收到 'reorder'。
  // 我们这里立刻开 confirm-sheet，让 TabBar 直接从"被 me-sheet 内嵌 orders 隐藏"
  // 平滑过渡到"被 confirm-sheet 隐藏"，避免中间一帧 TabBar 闪现。
  onMeReorder(e) {
    const tableId = (e.detail && e.detail.tableId) || this.data.tableId;
    if (tableId && this.data.tableId !== String(tableId)) {
      this.setData({ tableId: String(tableId) });
    }
    // 立刻开（不等动画），_updateTabBarVisibility 会发现 showConfirmSheet=true 直接隐藏 TabBar
    this.setData({ showConfirmSheet: true });
    this._updateTabBarVisibility();
  },

  // me-sheet → orders-sheet 的"查看详情"，me-sheet 仍保留，detail-sheet 叠在最上层
  onMeDetail(e) {
    const orderId = e.detail && e.detail.orderId;
    if (orderId) {
      this.openDetailSheet(orderId);
    }
  },

  // me-sheet 内的订单列表开关变更：用于 TabBar 显隐联动
  onMeOrdersSheet(e) {
    const open = !!(e.detail && e.detail.open);
    this.setData({ _meOrdersOpen: open });
    this._updateTabBarVisibility();
  },

  // 拦截系统返回键 / 手势：关闭 detail-sheet / confirm-sheet / me-sheet 而不是退出 order 页
  onBackPress() {
    if (this.data.showDetailSheet) {
      // 锁定模式：禁止返回
      if (this.data.detailLocked) {
        wx.showToast({ title: '请先完成当前订单', icon: 'none' });
        return true;
      }
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
