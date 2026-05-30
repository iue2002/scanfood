// pages/order/order.js
const { request, serverURL } = require('../../utils/request');
const { resolveImageUrl, toThumbnailUrl } = require('../../utils/image-url');

function generateIdempotencyKey() {
  return Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

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
    // 图片加载状态（淡入过渡）
    loadedImages: {},
    // 数量输入弹窗
    showQtyModal: false,
    editDishId: null,
    editDishName: '',
    editDishCount: 0,
    // 购物车弹窗
    showCartPanel: false,
    cartItems: [],
    // 下拉刷新状态（Skyline 模式下 enablePullDownRefresh 不生效，必须用 scroll-view refresher）
    _refreshing: false,
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
  _pendingOps: [],            // 增量操作指令累积队列（用于 sync-ops）

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
    // 订阅店铺信息变更：商家在 admin 改店名/头像后，下次 loadStoreInfo 拉到新值就会回调到这里
    try {
      const app = getApp();
      if (app && typeof app.subscribeStoreInfo === 'function') {
        this._unsubscribeStoreInfo = app.subscribeStoreInfo((info) => {
          this.setData({ storeInfo: info });
        });
      }
    } catch (e) { /* ignore */ }

    // 订阅菜品变化：商家在 admin 改菜品图/价格/状态后，缓存后台刷新检测到变更会回调到这里
    try {
      const dishesCache = require('../../utils/dishes-cache');
      if (dishesCache && typeof dishesCache.subscribe === 'function') {
        this._unsubscribeDishes = dishesCache.subscribe((newDishes) => {
          this._applyDishesUpdate(newDishes);
        });
      }
    } catch (e) { /* ignore */ }

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
    this._initialDataLoaded = true;

    // 异步检查未付款订单，不阻塞页面渲染
    this.checkActiveOrderAsync();
  },

  async checkActiveOrderAsync(force = false) {
    // 30 秒内只查一次，避免 TabBar 来回切时反复请求
    // force=true 用于扫码进入后桌台信息就绪时的强制兜底检查
    if (!force && this._lastActiveCheckAt && Date.now() - this._lastActiveCheckAt < 30000) {
      return;
    }
    this._lastActiveCheckAt = Date.now();

    try {
      const token = wx.getStorageSync('token');
      if (!token) {
        return;
      }
      // 1) 先检查自己名下的活跃订单
      const myOrder = await request({ url: '/orders/my-active', noLoading: true });
      if (myOrder && myOrder.id) {
        // 自动检测：跳转到 detail 真页面（锁定模式）
        this.navigateToDetail(myOrder.id, true);
        return;
      }
      // 2) 再检查当前桌台的活跃订单（即使不是自己的，作为桌台订阅者也要跟进）
      if (this.data.tableId && !this.data.isTakeaway) {
        const tableOrder = await request({ url: `/orders/current/${this.data.tableId}`, noLoading: true });
        if (tableOrder && tableOrder.id && ['submitted', 'printed', 'unpaid'].includes(tableOrder.status)) {
          this.navigateToDetail(tableOrder.id, true);
        }
      }
    } catch (err) {
      console.log('没有未完成的订单', err);
    }
  },

  async checkActiveOrder() {
    try {
      const token = wx.getStorageSync('token');
      if (!token) {
        if (this.data.tableId) {
          this.releaseTableResources();
        }
        return false;
      }
      const order = await request({ url: '/orders/my-active', noLoading: true });
      if (order && order.id) {
        this.navigateToDetail(order.id, true);
        return true;
      }
      if (this.data.tableId) {
        this.releaseTableResources();
      }
      return false;
    } catch (err) {
      console.log('没有未完成的订单', err);
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
    // TabBar 页面回到时显示 TabBar（从 confirm/detail/orders-list 返回时之前被 setHidden(true) 了）
    try {
      const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
      if (tabBar && tabBar.setHidden) tabBar.setHidden(false);
    } catch (e) { /* ignore */ }

    // 检查 globalData 信号：detail 页释放桌号后回到首页时同步清理 UI
    const app = getApp();
    if (app && app.globalData && app.globalData._tableReleased) {
      app.globalData._tableReleased = false;
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
      this.closeWebSocket();
    }

    // 检查 confirm 页提交校验失败时的 focusDishId 信号
    if (app && app.globalData && app.globalData.focusDishId) {
      const fid = app.globalData.focusDishId;
      app.globalData.focusDishId = null;
      // 找到该菜品所在分类，切过去
      const dish = this.data.allDishes.find(d => d.id == fid);
      if (dish && dish.category_id) {
        const cat = this.data.categories.find(c => c.id == dish.category_id);
        if (cat) {
          this.setData({
            currentCategory: cat.id,
            currentCategoryName: cat.name,
            dishes: this.data.allDishes.filter(d => d.category_id == cat.id)
          });
        }
      }
    }

    // 同步店铺信息（app.js 异步刷新的最新店名/头像可能在 onShow 时才到位）
    this.syncStoreInfo();
    // 触发一次后端刷新（5 分钟内会自动节流，多次调用安全）
    this.refreshStoreInfo();

    // 触发菜品后台刷新（30 秒内节流；商家在 admin 改完菜品/图片后顾客切回首页秒同步）
    try {
      const dishesCache = require('../../utils/dishes-cache');
      if (dishesCache && typeof dishesCache.refreshInBackground === 'function') {
        dishesCache.refreshInBackground();
      }
    } catch (e) { /* ignore */ }

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
        // 本地有购物车数据，恢复 UI
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
      } else if (!isSecondShow && !this._initialDataLoaded) {
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

    // onShow 时若有桌号但 ws 已关 → 重连
    if (this.data.tableId && !this._wsConnected && !this._wsConnecting) {
      this.initWebSocket();
    }

    // 异步检查未付款订单（已节流），不阻塞页面显示
    if (!isSecondShow) {
      this.checkActiveOrderAsync();
    }
  },

  // 菜品图片加载完成，触发淡入
  onDishImageLoad(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const key = `loadedImages.${id}`;
    if (!this.data.loadedImages[id]) {
      this.setData({ [key]: true });
    }
  },

  async onPullDownRefresh() {
    // 兼容老 webview 模式（Skyline 已被 onScrollRefresh 替代）
    await this._doRefresh();
    wx.stopPullDownRefresh();
  },

  async onScrollRefresh() {
    // Skyline 下 scroll-view 触发的下拉刷新
    this.setData({ _refreshing: true });
    await this._doRefresh();
    this.setData({ _refreshing: false });
  },

  async _doRefresh() {
    try {
      // 用户主动下拉：强制刷新店铺信息（绕过 5 分钟节流）
      const app = getApp();
      if (app && typeof app.loadStoreInfo === 'function') {
        app.loadStoreInfo(true);
      }
      await this.fetchData();
      if (this.data.tableId) {
        await this.fetchCurrentCart();
      }
    } catch (err) {
      console.error('下拉刷新失败', err);
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
    this._pendingOps = [];
    if (this._syncTimer) {
      clearTimeout(this._syncTimer);
      this._syncTimer = null;
    }
    // 解绑店铺信息订阅
    if (this._unsubscribeStoreInfo) {
      try { this._unsubscribeStoreInfo(); } catch (e) { /* ignore */ }
      this._unsubscribeStoreInfo = null;
    }
    // 解绑菜品变更订阅
    if (this._unsubscribeDishes) {
      try { this._unsubscribeDishes(); } catch (e) { /* ignore */ }
      this._unsubscribeDishes = null;
    }
    this.closeWebSocket();
    // 页面卸载兜底：关闭退出确认拦截，避免泄漏到其它页面
    this.disableExitGuard();
  },

  // ====== 自定义导航栏：店铺品牌信息同步 ======
  // 1) syncStoreInfo：从 globalData 拉一次（瞬时）
  // 2) refreshStoreInfo：触发 app 后台拉接口（30 秒节流，安全）
  // 3) _unsubscribeStoreInfo：订阅 app 的店铺变更广播（admin 改完立即同步，不用 setInterval）
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

  refreshStoreInfo() {
    try {
      const app = getApp();
      if (app && typeof app.loadStoreInfo === 'function') {
        // 不 await，让接口在后台跑；变更后通过 subscribe 回调
        app.loadStoreInfo();
      }
    } catch (e) {
      console.warn('[order] refreshStoreInfo failed', e);
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
      multiple: true, // 允许多 socket 共存（detail 页有独立订单 ws，与桌台 ws 不冲突）
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
      // 重连后兜底检查桌台是否有活跃订单（断线期间可能错过 orderStatusChanged）
      try { this.checkActiveOrderAsync(); } catch (e) { /* ignore */ }
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
    if (!order) return;
    if (['submitted', 'printed', 'unpaid'].includes(order.status)) {
      if (this.data.isAddMore) {
        return;
      }
      if (this._hasAutoNavigated) {
        return;
      }
      this._hasAutoNavigated = true;
      // ws 推送的未付款订单：跳到 detail 真页面（锁定模式）
      this.navigateToDetail(order.id, true);
    } else if (['settled', 'cancelled'].includes(order.status)) {
      // 订单已结账或取消，立即释放所有桌号资源
      this.releaseTableResources();
    }
  },

  handleCartUpdate(cart) {
    // 忽略本地刚刚同步上去的回声（150ms 内）——避免输入抖动闪屏
    // 窗口不能太长，否则 concurrent 操作会被漏掉
    if (this._lastSyncAt && Date.now() - this._lastSyncAt < 150) {
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

    // 叠加本地未同步操作，防止 WS 广播覆盖用户正在进行的操作
    const cartCount = this._mergeBackendCartWithPendingOps(cart.cart_items);

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
              image_url: dish.image_url || '',
              thumbnail_url: dish.thumbnail_url || ''
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

    // 重置自动跳转标记
    this._hasAutoNavigated = false;

    // 断开 WebSocket
    this.closeWebSocket();
  },

  async fetchTableInfo(id) {
    try {
      const table = await request({ url: `/tables/${id}`, noLoading: true });
      this.setData({ tableId: table.id, tableNumber: table.table_number });
      getApp().globalData.tableId = table.id;
      this.initWebSocket();
      // 桌台信息就绪后，强制检查该桌台是否有活跃订单
      this.checkActiveOrderAsync(true);
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
      // 桌台信息就绪后，强制检查该桌台是否有活跃订单（新用户扫码进入时直接跳转详情）
      this.checkActiveOrderAsync(true);
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

      allDishes = allDishes.map(dish => {
        dish.image_url = resolveImageUrl(dish.image_url);
        dish.thumbnail_url = toThumbnailUrl(dish.image_url);
        return dish;
      });

      const allCategory = { id: 'all', name: '全部', dish_count: allDishes.length };
      const categoriesWithAll = [allCategory].concat(categories);

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

  /** 菜品缓存变更回调：商家在 admin 改完菜品后，自动同步到 UI */
  _applyDishesUpdate(newDishes) {
    if (!Array.isArray(newDishes) || newDishes.length === 0) return;
    const allDishes = newDishes.map(dish => {
      dish.image_url = resolveImageUrl(dish.image_url);
      dish.thumbnail_url = toThumbnailUrl(dish.image_url);
      return dish;
    });
    this.setData({ allDishes });
    getApp().globalData.allDishes = allDishes;
    this.filterDishes();
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
        // 叠加本地未同步操作，防止拉取覆盖用户正在进行的操作
        const cartCount = this._mergeBackendCartWithPendingOps(cart.cart_items);
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
              image_url: dish.image_url || '',
              thumbnail_url: dish.thumbnail_url || ''
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

    // ⑥ 普通模式下累积增量操作指令（多人同时加菜时不互相覆盖）
    if (!isAddMore && !this.data.isTakeaway) {
      const delta = nextCount - count;
      const userInfo = getApp().globalData.userInfo;
      if (delta > 0) {
        this._pendingOps.push({
          idempotencyKey: generateIdempotencyKey(),
          action: 'add',
          dish_id: parseInt(id),
          quantity: delta,
          added_by_user_id: userInfo?.id,
          added_by_nickname: userInfo?.nickname || '未知用户'
        });
      } else if (delta < 0) {
        this._pendingOps.push({
          idempotencyKey: generateIdempotencyKey(),
          action: 'remove',
          dish_id: parseInt(id),
          quantity: -delta,
          added_by_user_id: userInfo?.id,
          added_by_nickname: userInfo?.nickname || '未知用户'
        });
      }
    }

    // ⑦ 防抖同步到后端，连续点击只发最后一次
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

  // 把后端购物车与本地未同步的 _pendingOps 合并，防止 WS 广播/拉取覆盖用户正在进行的操作
  _mergeBackendCartWithPendingOps(backendCartItems) {
    const cartCount = {};
    (backendCartItems || []).forEach(item => {
      cartCount[item.dish_id] = Number(item.quantity || 0);
    });

    if (this._pendingOps && this._pendingOps.length > 0) {
      this._pendingOps.forEach(op => {
        const id = op.dish_id;
        if (op.action === 'add') {
          cartCount[id] = (cartCount[id] || 0) + op.quantity;
        } else if (op.action === 'remove') {
          const newQty = (cartCount[id] || 0) - op.quantity;
          if (newQty <= 0) {
            delete cartCount[id];
          } else {
            cartCount[id] = newQty;
          }
        } else if (op.action === 'set') {
          if (op.quantity <= 0) {
            delete cartCount[id];
          } else {
            cartCount[id] = op.quantity;
          }
        }
      });
    }
    return cartCount;
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

    // 增量操作流：普通模式下优先发送累积的操作指令（多人同时加菜时不互相覆盖）
    if (!isAddMore && this._pendingOps && this._pendingOps.length > 0) {
      const ops = this._pendingOps.splice(0, this._pendingOps.length);
      this._lastSyncAt = Date.now();

      try {
        const result = await request({
          url: '/carts/sync-ops',
          method: 'POST',
          data: {
            table_id: parseInt(tableId),
            ops,
            user_id: getApp().globalData.userInfo?.id
          },
          noLoading: true
        });
        if (result && result.id) {
          const localCart = getApp().getCart(tableId);
          localCart.currentCartId = result.id;
          // 立即用后端结果 + 本地未同步操作更新 UI，不依赖 WS 广播
          const cartCount = this._mergeBackendCartWithPendingOps(result.cart_items);
          const patch = { currentCartId: result.id };
          if (!this.cartCountEqual(this.data.cartCount, cartCount)) {
            patch.cartCount = cartCount;
          }
          this.setData(patch);
          // 重新计算总价和购物车列表，保持 UI 一致性
          this.calculateTotal();
        }
      } catch (err) {
        console.error('增量同步购物车失败', err);
        // 网络失败：将操作恢复到队列头部，下次重试（幂等键保证服务端不会重复执行）
        this._pendingOps = ops.concat(this._pendingOps);
      }
      return;
    }

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
        // 用后端返回的 cart_items 更新本地状态（叠加未同步操作），保持各客户端一致
        if (result && result.cart_items) {
          const cartCount = this._mergeBackendCartWithPendingOps(result.cart_items);
          this.setData({ cartCount, currentCartId: nextCartId });
          this.calculateTotal();
        } else if (this.data.currentCartId !== nextCartId) {
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
            image_url: dish.image_url || '',
            thumbnail_url: dish.thumbnail_url || ''
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
      const { isAddMore, currentCartId, tableId } = this.data;
      if (isAddMore) {
        getApp().clearAddMoreCart(tableId);
        this.setData({ cartCount: {}, cartItems: [], totalCount: 0, totalPrice: '0.00' });
        this.syncCartToBackend();
      } else {
        getApp().clearCart(tableId);
        const cid = currentCartId;
        this.setData({ cartCount: {}, cartItems: [], totalCount: 0, totalPrice: '0.00', currentCartId: null });
        // 普通模式直接调用 DELETE API 清空购物车，避免发送一堆 remove 操作
        if (cid) {
          request({ url: `/carts/${cid}`, method: 'DELETE', noLoading: true }).catch(() => {});
        }
      }
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
      // 未登录：引导用户去「我的」tab 登录（真页面架构下，me 已经是真 tab 页面）
      const goLogin = () => wx.switchTab({ url: '/pages/me/me' });
      if (this.modal) {
        this.modal.show({
          title: '请先登录',
          content: '登录后即可下单外带',
          confirmText: '去登录',
          cancelText: '取消'
        }).then(confirmed => { if (confirmed) goLogin(); });
      } else {
        wx.showModal({
          title: '请先登录',
          content: '登录后即可下单外带',
          success: (res) => { if (res.confirm) goLogin(); }
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
      // 退出外带模式 + 跳到详情真页面（锁定模式直到付款 / 取消）
      this.exitTakeaway();
      setTimeout(() => {
        this.navigateToDetail(result.id, true);
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
      // 跳转到 confirm 真页面（栈式 navigateTo，按返回键自动 pop 回首页）
      wx.navigateTo({ url: `/pages/confirm/confirm?tableId=${this.data.tableId}` });
    }
  },

  // 跳转到详情真页面
  // locked=true：锁定模式，detail 页内部用 enableAlertBeforeUnload + z-index 提到 1500 拦截返回
  navigateToDetail(orderId, locked = false) {
    if (!orderId) return;
    const lockedFlag = locked ? '1' : '0';
    if (locked) {
      // 锁定模式：用 reLaunch 清空页面栈跳转（Skyline 下 redirectTo 从 tab 页跳转不可靠）
      wx.reLaunch({ url: `/pages/detail/detail?orderId=${orderId}&locked=${lockedFlag}` });
    } else {
      wx.navigateTo({ url: `/pages/detail/detail?orderId=${orderId}&locked=${lockedFlag}` });
    }
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
        this.navigateToDetail(result.id, true);
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

    const oldCount = cartCount[editDishId] || 0;

    if (editDishCount <= 0) {
      delete cartCount[editDishId];
    } else {
      cartCount[editDishId] = editDishCount;
    }

    this.setData({ editDishId: null, showQtyModal: false });

    // 内联计算 total 并合并 setData，避免 confirmQty 内连续 3 次渲染
    const totals = { count: 0, price: 0 };
    const allDishes = this.data.allDishes;
    for (const dishId in cartCount) {
      const cnt = cartCount[dishId];
      if (cnt > 0) {
        const dish = allDishes.find(d => d.id == dishId);
        if (dish) { totals.count += cnt; totals.price += cnt * parseFloat(dish.price); }
      }
    }
    this.setData({ cartCount, totalCount: totals.count, totalPrice: totals.price.toFixed(2) });
    const cart = isAddMore ? getApp().getAddMoreCart(this.data.tableId) : getApp().getCart(this.data.tableId);
    cart.cartCount = { ...cartCount };

    // 弹窗打开时同步刷新 cartItems
    if (this.data.showCartPanel) {
      this.refreshCartItems();
    }
    this.syncExitGuard();

    // 普通模式下累积增量操作指令（用 add/remove delta 代替 set，避免并发覆盖）
    if (!isAddMore) {
      const userInfo = getApp().globalData.userInfo;
      // 用弹窗打开时的 oldCount 计算 delta（注意：setData 后 this.data.cartCount 已被更新，不能再用）
      const delta = editDishCount - oldCount;
      if (delta > 0) {
        this._pendingOps.push({
          idempotencyKey: generateIdempotencyKey(),
          action: 'add',
          dish_id: parseInt(editDishId),
          quantity: delta,
          added_by_user_id: userInfo?.id,
          added_by_nickname: userInfo?.nickname || '未知用户'
        });
      } else if (delta < 0) {
        this._pendingOps.push({
          idempotencyKey: generateIdempotencyKey(),
          action: 'remove',
          dish_id: parseInt(editDishId),
          quantity: -delta,
          added_by_user_id: userInfo?.id,
          added_by_nickname: userInfo?.nickname || '未知用户'
        });
      }
    }

    this.syncCartToBackend();
  },

  // ====== 'TabBar 显隐管理（真页面架构下不再需要） ======
  // 旧 sheet 架构需要在 sheet 打开时隐藏 TabBar；
  // 真页面架构下，wx.navigateTo 后 TabBar 自动隐藏（页面级而非 tab 级），所以这个函数现在只是 no-op，
  // 保留以兼容遗留调用点。
  _updateTabBarVisibility() {
    // no-op
  }
})
