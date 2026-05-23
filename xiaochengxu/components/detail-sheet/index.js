// components/detail-sheet/index.js
// "订单详情"全屏弹窗：业务逻辑与 pages/order/detail.js 完全一致
// WS 生命周期跟随 visible：打开订阅、关闭断开
const { request } = require('../../utils/request');
const { SERVER_URL } = require('../../config');
const dishesCache = require('../../utils/dishes-cache');

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
      observer(newVal) {
        if (newVal) {
          this.handleOpen();
        } else {
          this.handleClose();
        }
      }
    },
    orderId: {
      type: String,
      value: '',
      observer(newVal) {
        if (newVal && this.data.visible) {
          this.orderId = newVal;
          this.fetchOrderDetail(newVal);
          this.initWebSocket(newVal);
        }
      }
    },
    // 锁定模式：用于强制拦截未完成订单（自动检测 / ws 推送进来时为 true）
    // - 隐藏返回按钮、盖住 TabBar、拦截系统返回
    // - 订单变 settled/cancelled 时自动解锁并关闭
    locked: {
      type: Boolean,
      value: false
    }
  },

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
    // 数量输入弹窗
    showQtyModal: false,
    editDishId: null,
    editDishName: '',
    editDishCount: 0,
    // sheet 入场动画
    sheetIn: false,
    statusBarHeight: 0
  },

  // WebSocket 状态管理（实例字段，不放 data）
  ws: null,
  wsStatus: 'closed',
  reconnectDelay: 1000,
  maxReconnectDelay: 30000,
  reconnectTimer: null,
  pollTimer: null,
  orderId: null,

  lifetimes: {
    attached() {
      try {
        const sysInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        this.setData({ statusBarHeight: sysInfo.statusBarHeight || 20 });
      } catch (e) {
        this.setData({ statusBarHeight: 20 });
      }
    },
    detached() {
      this.disconnect();
    }
  },

  methods: {
    handleOpen() {
      const id = this.data.orderId || this.orderId;
      if (!id) return;
      this.orderId = id;

      // 重置每次打开的 UI 状态
      this.setData({
        sheetIn: false,
        isLoading: true,
        order: null,
        showAddMoreModal: false,
        addMoreCartCount: {},
        addMoreTotal: 0,
        cartItemCount: 0,
        addMoreTotalStr: '0.00'
      });
      wx.nextTick(() => {
        this.setData({ sheetIn: true });
      });

      this.fetchOrderDetail(id);
      this.initWebSocket(id);
    },

    handleClose() {
      // visible=false 时由父级触发：断开 WS / 停止轮询
      this.disconnect();
    },

    onClose() {
      // 锁定模式禁止用户主动关闭（强制完成订单才能离开）
      if (this.data.locked) {
        wx.showToast({
          title: '请先完成当前订单',
          icon: 'none'
        });
        return;
      }
      this.setData({ sheetIn: false });
      setTimeout(() => {
        this.triggerEvent('close');
      }, 220);
    },

    // 内部用：忽略 locked，强制关闭（订单已结账/取消时自动调用）
    forceClose() {
      this.setData({ sheetIn: false });
      setTimeout(() => {
        this.triggerEvent('close');
      }, 220);
    },

    // ====== 以下方法逐字迁移自 pages/order/detail.js（业务零修改） ======

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
          this.ws.close({ code: 1000, reason: 'sheet close' });
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

      console.log(`[WS-detail] 正在连接: ${wsUrl}`);

      this.ws = wx.connectSocket({ url: wsUrl });

      this.ws.onOpen(() => {
        console.log('[WS-detail] 连接成功');
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
            this.fetchOrderDetail(this.orderId || orderId);
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
        console.log('[WS-detail] 连接关闭, code:', res.code, ', reason:', res.reason);
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

        this.setData({ order, isLoading: false });

        // 通知父级状态变化（用于关 sheet 后释放桌号）
        this.triggerEvent('statuschange', { status: order.status, orderId: id });

        // 如果订单已结账/取消，立即释放桌号资源；锁定模式下也要解锁让用户离开
        if (order.status === 'settled' || order.status === 'cancelled') {
          this.releaseTableResources();
          // 通知父级解锁（订单已完成，允许关闭）
          if (this.data.locked) {
            this.triggerEvent('unlock', { orderId: id });
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

    // 释放桌号资源 - 结账后必须清理，避免缓存导致下次进入混乱
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
      }

      this.disconnect();

      // 通知父级桌号已释放（让 order 页同步更新自己的 tableId 等状态）
      this.triggerEvent('tablereleased');
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
  }
});
