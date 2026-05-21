// pages/order/detail.js
const { request } = require('../../utils/request');
const { SERVER_URL } = require('../../config');

Page({
  data: {
    order: null,
    statusMap: {
      'draft': '待提交',
      'submitted': '已提交',
      'printed': '已下单',
      'settled': '已结账',
      'cancelled': '已取消',
      'refunded': '已退款'
    },
    showAddMoreModal: false,
    categories: [],
    currentCategory: '',
    allDishes: [],
    dishes: [],
    addMoreCartCount: {},
    addMoreTotal: 0,
    cartItemCount: 0,
    addMoreTotalStr: '0.00',
    // 数量输入弹窗
    showQtyModal: false,
    editDishId: null,
    editDishName: '',
    editDishCount: 0
  },

  // WebSocket 状态管理
  ws: null,
  wsStatus: 'closed', // closed, connecting, connected
  reconnectDelay: 1000,
  maxReconnectDelay: 30000,
  reconnectTimer: null,
  pollTimer: null,
  orderId: null,

  onLoad(options) {
    this.orderId = options.id;
    this.fetchOrderDetail(options.id);
    this.initWebSocket(options.id);
  },

  onUnload() {
    this.disconnect();
  },

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
    if (this.ws) {
      try {
        this.ws.close({ code: 1000, reason: 'page unload' });
      } catch (e) {}
      this.ws = null;
    }
  },

  initWebSocket(orderId) {
    if (!SERVER_URL || this.wsStatus === 'connecting') return;

    const token = wx.getStorageSync('token');
    if (!token) {
      this.startPolling(orderId);
      return;
    }

    this.wsStatus = 'connecting';
    const wsUrl = SERVER_URL.replace('http', 'ws').replace('https', 'wss') + `/ws?token=${token}`;
    
    console.log(`[WS] 正在连接: ${wsUrl}`);

    this.ws = wx.connectSocket({ url: wsUrl });

    this.ws.onOpen(() => {
      console.log('[WS] 连接成功');
      this.wsStatus = 'connected';
      this.reconnectDelay = 1000;
      this._reconnectCount = 0;
      this.stopPolling();
      this.sendSubscribe(orderId);
    });

    this.ws.onMessage((res) => {
      try {
        const message = JSON.parse(res.data);
        if (message.event === 'orderUpdated' || message.event === 'orderStatusChanged') {
          this.fetchOrderDetail(orderId);
        }
      } catch (e) {
        console.error('[WS] 消息解析失败', e);
      }
    });

    this.ws.onError((err) => {
      console.error('[WS] 连接错误:', err);
      this.handleDisconnect(orderId);
    });

    this.ws.onClose((res) => {
      console.log('[WS] 连接关闭, code:', res.code, ', reason:', res.reason);
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
      console.error('[WS] 发送失败', e);
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

    // 使用轮询作为备用（无论是否继续重连，轮询都是兜底）
    this.startPolling(orderId);

    // 重连次数限制：最多 5 次指数退避重连，之后只靠轮询
    this._reconnectCount = (this._reconnectCount || 0) + 1;
    const maxReconnect = 5;
    if (this._reconnectCount > maxReconnect) {
      console.log(`[WS] 已达最大重连次数(${maxReconnect})，停止重连，仅轮询`);
      return;
    }

    // 指数退避重连
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
    
    console.log(`[WS] ${delay}ms 后尝试重连 (${this._reconnectCount}/${maxReconnect})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.initWebSocket(orderId);
    }, delay);
  },

  startPolling(orderId) {
    if (this.pollTimer) return;
    console.log('[Poll] 启动轮询');
    this.pollTimer = setInterval(() => {
      const order = this.data.order;
      if (order?.status !== 'settled' && order?.status !== 'cancelled') {
        this.fetchOrderDetail(orderId);
      }
    }, 10000);
  },

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      console.log('[Poll] 停止轮询');
    }
  },

  async fetchOrderDetail(id) {
    try {
      const order = await request({ url: `/orders/${id}` });

      if (order.order_items && order.order_items.length > 0) {
        const dishes = await request({ url: '/dishes' });

        order.order_items = order.order_items.map(item => {
          const dish = dishes.find(d => d.id === item.dish_id);
          let dishImage = dish ? dish.image_url : '';
          if (dishImage && !dishImage.startsWith('http')) {
            dishImage = SERVER_URL + (dishImage.startsWith('/') ? '' : '/') + dishImage;
          }
          return {
            ...item,
            dish_image: dishImage
          };
        });

        order.groupedItems = this.groupItemsByRound(order.order_items);
      }

      if (order.created_at) {
        order.created_at = this.formatDate(order.created_at);
      }
      if (order.settled_at) {
        order.settled_at = this.formatDate(order.settled_at);
      }

      this.setData({ order });

      // 如果订单已结账，立即释放桌号资源
      if (order.status === 'settled' || order.status === 'cancelled') {
        this.releaseTableResources();
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

  // 释放桌号资源 - 结账后必须清理，避免缓存导致下次进入混乱
  releaseTableResources() {
    console.log('订单已结账/取消，释放桌号资源');

    // 停止轮询
    this.stopPolling();

    // 清除本地存储的桌号
    wx.removeStorageSync('savedTableId');
    wx.removeStorageSync('tableNumber');

    // 清除全局数据中的桌号
    const app = getApp();
    if (app) {
      app.globalData.tableId = null;
      app.globalData.carts = {};
      app.globalData.addMoreCarts = {};
      app.globalData.addMore = false;
    }

    // 断开 WebSocket 连接
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
      const categories = await request({ url: '/dishes/categories', noLoading: true });
      let allDishes = await request({ url: '/dishes', noLoading: true });

      allDishes = allDishes.map(dish => {
        if (dish.image_url && !dish.image_url.startsWith('http')) {
          dish.image_url = SERVER_URL + (dish.image_url.startsWith('/') ? '' : '/') + dish.image_url;
        }
        return dish;
      });

      this.setData({
        categories,
        allDishes,
        currentCategory: categories.length > 0 ? categories[0].id : '',
        dishes: categories.length > 0 ? allDishes.filter(d => d.category_id == categories[0].id) : []
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

  preventClose() {
    // 阻止事件冒泡，防止点击弹窗内容时关闭弹窗
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
    const { editDishId, editDishCount, addMoreCartCount, allDishes } = this.data;
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
})
