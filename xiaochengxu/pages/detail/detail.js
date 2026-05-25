// pages/detail/detail.js
// 订单详情真页面：从 components/detail-sheet/index.js 1:1 迁移业务逻辑
// 关键变化：
//   - properties → onLoad(options.orderId, options.locked)
//   - triggerEvent('close') / 'unlock' / 'tablereleased' → wx.navigateBack / globalData 信号
//   - 锁定模式下用 wx.enableAlertBeforeUnload 拦截系统返回（看起来锁住）+ z-index 提到 1500 盖 TabBar
const { request } = require('../../utils/request');
const { SERVER_URL } = require('../../config');
const dishesCache = require('../../utils/dishes-cache');

Page({
  data: {
    orderId: '',
    locked: false,
    order: null,
    statusMap: {
      'draft': '待提交',
      'submitted': '已提交',
      'printed': '已下单',
      'settled': '已结账',
      'cancelled': '已取消',
      'refunded': '已退款'
    },
    isLoading: true,
    showAddMoreModal: false,
    categories: [],
    currentCategory: '',
    allDishes: [],
    dishes: [],
    addMoreCartCount: {},
    addMoreTotal: 0,
    cartItemCount: 0,
    addMoreTotalStr: '0.00',
    showQtyModal: false,
    editDishId: null,
    editDishName: '',
    editDishCount: 0,
    statusBarHeight: 0,
    storeInfo: null
  },

  // WebSocket 状态管理（实例字段）
  ws: null,
  wsStatus: 'closed',
  reconnectDelay: 1000,
  maxReconnectDelay: 30000,
  reconnectTimer: null,
  pollTimer: null,
  safetyNetTimer: null,
  _heartbeatTimer: null,
  _exitGuardEnabled: false,

  onLoad(options) {
    try {
      const sysInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.setData({ statusBarHeight: sysInfo.statusBarHeight || 20 });
    } catch (e) {
      this.setData({ statusBarHeight: 20 });
    }

    const orderId = String(options.orderId || '');
    const locked = options.locked === '1';
    this.setData({ orderId, locked });

    // 锁定模式下：开启退出确认拦截系统返回（视觉上等同"按返回无效"，等订单完成才让走）
    if (locked) {
      try {
        if (wx.enableAlertBeforeUnload) {
          wx.enableAlertBeforeUnload({ message: '请先完成当前订单' });
          this._exitGuardEnabled = true;
        }
      } catch (e) { /* ignore */ }
    }

    // 订阅店铺信息变更
    try {
      const app = getApp();
      if (app && typeof app.subscribeStoreInfo === 'function') {
        this._unsubscribeStoreInfo = app.subscribeStoreInfo((info) => {
          if (info && info.store_name) {
            const letter = (info.store_name || '').charAt(0).toUpperCase();
            this.setData({ storeInfo: { ...info, store_name_letter: letter } });
          }
        });
      }
      const storeInfo = app && app.globalData && app.globalData.storeInfo;
      if (storeInfo && storeInfo.store_name) {
        const letter = (storeInfo.store_name || '').charAt(0).toUpperCase();
        this.setData({ storeInfo: { ...storeInfo, store_name_letter: letter } });
      }
    } catch (e) { /* ignore */ }

    // 关键：先 fetch 拿到状态，再决定要不要建 ws
    this.fetchOrderDetail(orderId);

    // 锁定模式立即启动安全网轮询
    if (locked) {
      this.startSafetyNetPolling(orderId);
    }
  },

  onShow() {
    // 隐藏底部 TabBar（detail 是 navigateTo/redirectTo 进入的非 TabBar 页面）
    try {
      const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
      if (tabBar && tabBar.setHidden) tabBar.setHidden(true);
    } catch (e) { /* ignore */ }

    // 锁定模式下，用户从其他场景回来时强制核对一次最新订单状态（与 order 页 _refreshLockedOrderStatus 同款逻辑）
    if (this.data.locked && this.data.orderId) {
      this._refreshLockedOrderStatus(this.data.orderId);
    }
  },

  onUnload() {
    if (this._unsubscribeStoreInfo) {
      try { this._unsubscribeStoreInfo(); } catch (e) { /* ignore */ }
      this._unsubscribeStoreInfo = null;
    }
    this.disconnect();
    // 关闭退出确认，避免污染其它页面
    if (this._exitGuardEnabled) {
      try {
        if (wx.disableAlertBeforeUnload) {
          wx.disableAlertBeforeUnload();
        }
      } catch (e) { /* ignore */ }
      this._exitGuardEnabled = false;
    }
  },

  onBack() {
    // 锁定模式禁止返回（视觉上隐藏返回按钮，但万一被点也兜底拦截）
    if (this.data.locked) {
      wx.showToast({ title: '请先完成当前订单', icon: 'none' });
      return;
    }
    wx.navigateBack().catch(() => {
      wx.switchTab({ url: '/pages/order/order' });
    });
  },

  // ====== 锁定模式核心：用 my-active 兜底（onShow 触发） ======
  async _refreshLockedOrderStatus(orderId) {
    try {
      const order = await request({ url: '/orders/my-active', noLoading: true });
      if (!order || !order.id) {
        // 后端无活跃订单 → 顾客已被结账/取消 → 自动解锁释放
        this.releaseTableResources();
        this._unlockAndExit();
        return;
      }
      if (order.status === 'settled' || order.status === 'cancelled') {
        this.releaseTableResources();
        this._unlockAndExit();
      }
    } catch (err) {
      console.warn('[detail] 核对锁定订单状态失败', err);
    }
  },

  // 解锁并自动退出页面
  _unlockAndExit() {
    this.setData({ locked: false });
    if (this._exitGuardEnabled) {
      try {
        if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload();
      } catch (e) { /* ignore */ }
      this._exitGuardEnabled = false;
    }
    // 自动跳回首页（订单已结账，不再停留在详情页）
    setTimeout(() => {
      wx.reLaunch({ url: '/pages/order/order' });
    }, 200);
  },

  // ====== WebSocket 管理 ======
  disconnect() {
    this.wsStatus = 'closed';
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this._stopHeartbeat();
    this.stopSafetyNetPolling();
    if (this.ws) {
      try {
        this.ws.close({ code: 1000, reason: 'page unload' });
      } catch (e) {}
      this.ws = null;
    }
  },

  _startHeartbeat() {
    this._stopHeartbeat();
    this._heartbeatTimer = setInterval(() => {
      if (this.wsStatus === 'connected' && this.ws) {
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

  initWebSocket(orderId) {
    if (!SERVER_URL) return;
    if (this.wsStatus === 'connecting' || this.wsStatus === 'connected') return;
    if (this.ws) {
      try { this.ws.close({ code: 1000, reason: 'reconnect' }); } catch (e) {}
      this.ws = null;
    }
    const token = wx.getStorageSync('token');
    if (!token) {
      this.startPolling(orderId);
      return;
    }
    this.wsStatus = 'connecting';
    const wsUrl = SERVER_URL.replace('http', 'ws').replace('https', 'wss') + `/ws?token=${token}`;
    console.log(`[WS-detail] 正在连接: ${wsUrl}`);

    // multiple: true 让本页 ws 与 order 页桌台 ws 并存
    this.ws = wx.connectSocket({ url: wsUrl, multiple: true });

    this.ws.onOpen(() => {
      console.log('[WS-detail] 连接成功');
      this.wsStatus = 'connected';
      this.reconnectDelay = 1000;
      this._reconnectCount = 0;
      this.stopPolling();
      this.sendSubscribe(orderId);
      this._startHeartbeat();
      if (this.data.locked) {
        this.startSafetyNetPolling(orderId);
      }
      try { this.fetchOrderDetail(this.data.orderId || orderId); } catch (e) { /* ignore */ }
    });

    this.ws.onMessage((res) => {
      try {
        const message = JSON.parse(res.data);
        if (message.event === 'orderUpdated' || message.event === 'orderStatusChanged') {
          this.fetchOrderDetail(this.data.orderId || orderId);
        }
      } catch (e) {
        console.error('[WS-detail] 消息解析失败', e);
      }
    });

    this.ws.onError((err) => {
      console.error('[WS-detail] 连接错误:', err);
      this.handleDisconnect(orderId);
    });

    this.ws.onClose((res) => {
      console.log('[WS-detail] 连接关闭, code:', res.code);
      if (res.code !== 1000) {
        this.handleDisconnect(orderId);
      }
    });
  },

  sendSubscribe(orderId) {
    if (!this.ws || this.wsStatus !== 'connected') return;
    try {
      this.ws.send({
        data: JSON.stringify({ event: 'subscribeOrder', data: { orderId } })
      });
    } catch (e) {
      console.error('[WS-detail] 发送失败', e);
    }
  },

  handleDisconnect(orderId) {
    if (this.wsStatus === 'closed') return;
    const order = this.data.order;
    if (order?.status === 'settled' || order?.status === 'cancelled') {
      this.wsStatus = 'closed';
      return;
    }
    this.wsStatus = 'closed';
    this.ws = null;
    this.startPolling(orderId);

    this._reconnectCount = (this._reconnectCount || 0) + 1;
    const maxReconnect = 5;
    if (this._reconnectCount > maxReconnect) {
      console.log(`[WS-detail] 已达最大重连次数(${maxReconnect})，停止重连，仅轮询`);
      return;
    }
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
    console.log(`[WS-detail] ${delay}ms 后尝试重连 (${this._reconnectCount}/${maxReconnect})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.initWebSocket(orderId);
    }, delay);
  },

  startPolling(orderId) {
    if (this.pollTimer) return;
    console.log('[Poll-detail] 启动轮询');
    this.pollTimer = setInterval(() => {
      const order = this.data.order;
      if (order?.status !== 'settled' && order?.status !== 'cancelled') {
        this.fetchOrderDetail(orderId);
      }
    }, 10000);
  },

  /**
   * 兜底轮询，仅锁定模式下激活，15s 一次
   */
  startSafetyNetPolling(orderId) {
    if (this.safetyNetTimer) return;
    console.log('[SafetyNet-detail] 启动锁定模式安全网');
    this.safetyNetTimer = setInterval(() => {
      const order = this.data.order;
      if (order && (order.status === 'settled' || order.status === 'cancelled')) {
        this.stopSafetyNetPolling();
        return;
      }
      if (this.data.locked) {
        this.fetchOrderDetail(orderId);
      } else {
        this.stopSafetyNetPolling();
      }
    }, 15000);
  },

  stopSafetyNetPolling() {
    if (this.safetyNetTimer) {
      clearInterval(this.safetyNetTimer);
      this.safetyNetTimer = null;
      console.log('[SafetyNet-detail] 停止');
    }
  },

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      console.log('[Poll-detail] 停止轮询');
    }
  },

  async fetchOrderDetail(id) {
    try {
      const [order, dishes] = await Promise.all([
        request({ url: `/orders/${id}`, noLoading: true }),
        dishesCache.getDishes()
      ]);

      if (order.order_items && order.order_items.length > 0) {
        order.order_items = order.order_items.map(item => {
          const dish = dishes.find(d => d.id === item.dish_id);
          let dishImage = dish ? dish.image_url : '';
          if (dishImage && !dishImage.startsWith('http')) {
            dishImage = SERVER_URL + (dishImage.startsWith('/') ? '' : '/') + dishImage;
          }
          return { ...item, dish_image: dishImage };
        });
        order.groupedItems = this.groupItemsByRound(order.order_items);
      }

      if (order.created_at) order.created_at = this.formatDate(order.created_at);
      if (order.settled_at) order.settled_at = this.formatDate(order.settled_at);

      this.setData({ order, isLoading: false });

      // 终态处理
      if (order.status === 'settled' || order.status === 'cancelled') {
        if (this.data.locked) {
          // 锁定模式下订单完成 → 释放桌号 + 自动退出
          this.releaseTableResources();
          this._unlockAndExit();
        } else {
          // 非锁定模式下看到的历史订单已经到终态，断 ws + 停轮询
          this.disconnect();
        }
      } else {
        // 活跃订单：建立 ws 订阅状态变化
        if (this.wsStatus !== 'connecting' && this.wsStatus !== 'connected') {
          this.initWebSocket(id);
        }
      }
    } catch (err) {
      console.error('获取订单详情失败', err);
    }
  },

  groupItemsByRound(items) {
    if (!items || items.length === 0) return [];
    const sorted = [...items].sort((a, b) => (a.add_more_round || 0) - (b.add_more_round || 0));
    const groups = [];
    let currentGroup = [sorted[0]];
    let currentRound = sorted[0].add_more_round || 0;

    for (let i = 1; i < sorted.length; i++) {
      const itemRound = sorted[i].add_more_round || 0;
      if (itemRound === currentRound) {
        currentGroup.push(sorted[i]);
      } else {
        groups.push({
          round: currentRound,
          label: currentRound === 0 ? '首次点餐' : `第${currentRound}次加餐`,
          items: currentGroup
        });
        currentGroup = [sorted[i]];
        currentRound = itemRound;
      }
    }
    groups.push({
      round: currentRound,
      label: currentRound === 0 ? '首次点餐' : `第${currentRound}次加餐`,
      items: currentGroup
    });
    return groups;
  },

  // 释放桌号资源
  releaseTableResources() {
    console.log('订单已结账/取消，释放桌号资源');
    this.stopPolling();

    wx.removeStorageSync('savedTableId');
    wx.removeStorageSync('tableNumber');

    const app = getApp();
    if (app) {
      app.globalData.tableId = null;
      app.globalData.carts = {};
      app.globalData.addMoreCarts = {};
      app.globalData.addMore = false;
      // 通知 order 页：表已释放，需清空 UI
      app.globalData._tableReleased = true;
    }
    this.disconnect();
  },

  formatDate(dateStr) {
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hour}:${minute}`;
  },

  goToOrder() {
    this.setData({ showAddMoreModal: true });
    this.fetchCategoriesAndDishes();
  },

  async fetchCategoriesAndDishes() {
    try {
      const [categories, allDishes] = await Promise.all([
        request({ url: '/dishes/categories', noLoading: true }),
        dishesCache.getDishes()
      ]);
      const processed = (allDishes || []).map(dish => {
        if (dish.image_url && !dish.image_url.startsWith('http')) {
          if (dish.image_url.includes('__tmp__') || dish.image_url.includes('tmp/')) {
            dish.image_url = '';
          } else {
            dish.image_url = SERVER_URL + (dish.image_url.startsWith('/') ? '' : '/') + dish.image_url;
          }
        }
        return dish;
      });

      this.setData({
        categories,
        allDishes: processed,
        currentCategory: categories.length > 0 ? categories[0].id : '',
        dishes: categories.length > 0 ? processed.filter(d => d.category_id == categories[0].id) : []
      });
    } catch (err) {
      console.error('加载菜品数据失败', err);
    }
  },

  switchCategory(e) {
    const id = e.currentTarget.dataset.id;
    const dishes = this.data.allDishes.filter(d => d.category_id == id);
    this.setData({ currentCategory: id, dishes });
  },

  updateAddMoreCart(e) {
    const { id, type } = e.currentTarget.dataset;
    const addMoreCartCount = { ...this.data.addMoreCartCount };
    const count = addMoreCartCount[id] || 0;

    if (type === 'plus') {
      addMoreCartCount[id] = count + 1;
    } else {
      addMoreCartCount[id] = Math.max(0, count - 1);
      if (addMoreCartCount[id] === 0) {
        delete addMoreCartCount[id];
      }
    }
    const addMoreTotal = this.calculateAddMoreTotal(addMoreCartCount);
    const cartItemCount = Object.keys(addMoreCartCount).length;
    const addMoreTotalStr = addMoreTotal.toFixed(2);
    this.setData({ addMoreCartCount, addMoreTotal, cartItemCount, addMoreTotalStr });
  },

  calculateAddMoreTotal(cartCount) {
    const { allDishes } = this.data;
    let total = 0;
    for (const dishId in cartCount) {
      const dish = allDishes.find(d => d.id == dishId);
      if (dish) {
        total += parseFloat(dish.price) * cartCount[dishId];
      }
    }
    return parseFloat(total.toFixed(2));
  },

  closeAddMoreModal() {
    this.setData({
      showAddMoreModal: false,
      addMoreCartCount: {},
      addMoreTotal: 0,
      cartItemCount: 0,
      addMoreTotalStr: '0.00'
    });
  },

  preventClose() {},

  copyOrderNumber(e) {
    const text = e.currentTarget.dataset.text;
    if (!text) return;
    wx.setClipboardData({
      data: String(text),
      success: () => {
        wx.showToast({ title: '订单号已复制', icon: 'success' });
      },
      fail: () => {
        wx.showToast({ title: '复制失败', icon: 'none' });
      }
    });
  },

  async submitAddMore() {
    const { addMoreCartCount, allDishes, order } = this.data;
    const items = [];
    const userInfo = getApp().globalData.userInfo;
    for (const id in addMoreCartCount) {
      const count = addMoreCartCount[id];
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
      wx.showToast({ title: '请先选择菜品', icon: 'none' });
      return;
    }

    const totalAmount = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const itemNames = items.map(i => `${i.dish_name} x${i.quantity}`).join('、');

    wx.showModal({
      title: '确认加餐',
      content: `${itemNames}\n合计：¥${totalAmount.toFixed(2)}`,
      confirmText: '确认提交',
      cancelText: '再想想',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '提交中...' });
          try {
            await request({
              url: `/orders/${order.id}/sync-add-more`,
              method: 'POST',
              data: { items }
            });
            this.setData({
              addMoreCartCount: {},
              addMoreTotal: 0,
              cartItemCount: 0,
              addMoreTotalStr: '0.00',
              showAddMoreModal: false
            });
            wx.hideLoading();
            wx.showToast({ title: '加餐已提交', icon: 'success' });
            this.fetchOrderDetail(order.id);
          } catch (err) {
            wx.hideLoading();
            wx.showToast({ title: '提交失败', icon: 'none' });
            console.error('提交加餐失败', err);
          }
        }
      }
    });
  },

  // ===== 加餐数量输入弹窗 =====
  onAddMoreCountTap(e) {
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

  onQtyInput(e) {
    const val = parseInt(e.detail.value);
    this.setData({ editDishCount: isNaN(val) ? 0 : Math.max(0, val) });
  },

  onQtyQuickSet(e) {
    const val = parseInt(e.currentTarget.dataset.val);
    this.setData({ editDishCount: isNaN(val) ? 0 : Math.max(0, val) });
  },

  confirmQty() {
    const { editDishId, editDishCount, addMoreCartCount } = this.data;
    if (editDishId === null) return;

    if (editDishCount <= 0) {
      delete addMoreCartCount[editDishId];
    } else {
      addMoreCartCount[editDishId] = editDishCount;
    }
    const addMoreTotal = this.calculateAddMoreTotal(addMoreCartCount);
    const cartItemCount = Object.keys(addMoreCartCount).length;
    const addMoreTotalStr = addMoreTotal.toFixed(2);
    this.setData({
      addMoreCartCount,
      addMoreTotal,
      cartItemCount,
      addMoreTotalStr,
      showQtyModal: false,
      editDishId: null
    });
  }
});
