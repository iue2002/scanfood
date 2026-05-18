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
    currentOrderId: null,
    orderStatus: null,
    hasScannedTable: false,
    isAddMore: false
  },

  isFetchingOrder: false,
  ws: null,

  async onLoad(options) {
    let tableNumber = null;
    let rawTableId = options.tableId || getApp().globalData.tableId;

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

    // 先处理桌台信息并加载数据，让用户立即看到内容
    if (tableNumber) {
      this.setData({ tableNumber, hasScannedTable: true });
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
    try {
      const token = wx.getStorageSync('token');
      if (!token) {
        console.log('未登录，跳过检查未完成订单');
        return;
      }
      const order = await request({ url: '/orders/my-active', noLoading: true });
      console.log('checkActiveOrder 结果:', order);
      if (order && order.id) {
        // 发现未付款订单后跳转
        wx.navigateTo({
          url: `/pages/order/detail?id=${order.id}`,
          fail: (err) => {
            console.error('跳转订单详情失败:', err);
            wx.showToast({ title: '跳转失败', icon: 'none' });
          }
        });
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
        return false;
      }
      const order = await request({ url: '/orders/my-active', noLoading: true });
      console.log('checkActiveOrder 结果:', order);
      if (order && order.id) {
        // 直接跳转到订单详情页，不需要再加载点餐页面
        // 使用 navigateTo 避免 tabBar 页面 redirectTo 异常
        wx.navigateTo({
          url: `/pages/order/detail?id=${order.id}`,
          fail: (err) => {
            console.error('跳转订单详情失败:', err);
            wx.showToast({ title: '跳转失败', icon: 'none' });
          }
        });
        return true;
      }
      return false;
    } catch (err) {
      console.log('没有未完成的订单', err);
      return false;
    }
  },

  async onShow() {
    // 先处理页面状态，让用户立即看到内容
    if (getApp().globalData.addMore) {
      getApp().globalData.addMore = false;
      this.setData({ isAddMore: true });
    }

    if (this.data.tableId && !this.data.isAddMore) {
      this.setData({ cartCount: {}, currentOrderId: null, orderStatus: null, totalCount: 0, totalPrice: '0.00' });
      this.fetchCurrentOrder();
    } else if (this.data.tableId && this.data.isAddMore) {
      const addMoreCart = getApp().getAddMoreCart(this.data.tableId);
      if (!addMoreCart.currentOrderId) {
        this.fetchCurrentOrderForAddMore();
      } else {
        this.setData({
          cartCount: { ...addMoreCart.cartCount },
          currentOrderId: addMoreCart.currentOrderId,
          orderStatus: addMoreCart.orderStatus
        });
        this.calculateTotal();
      }
    }
    this.updateTabBar();

    // 异步检查未付款订单，不阻塞页面显示
    this.checkActiveOrderAsync();
  },

  updateTabBar() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
  },

  onUnload() {
    this.closeWebSocket();
  },

  initWebSocket() {
    if (!this.data.tableId) return;
    
    const wsUrl = serverURL.replace('http', 'ws').replace('https', 'wss') + '/ws';
    console.log('连接 WebSocket:', wsUrl);
    
    this.ws = wx.connectSocket({
      url: wsUrl,
      success: () => {
        console.log('WebSocket 连接成功');
      },
      fail: (err) => {
        console.error('WebSocket 连接失败', err);
      }
    });

    this.ws.onOpen(() => {
      console.log('WebSocket 已打开，订阅桌台:', this.data.tableId);
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
        
        if (message.event === 'orderUpdated' || message.event === 'orderStatusChanged') {
          this.handleOrderUpdate(message.data);
        }
      } catch (err) {
        console.error('解析 WebSocket 消息失败', err);
      }
    });

    this.ws.onError((err) => {
      console.error('WebSocket 错误', err);
    });

    this.ws.onClose(() => {
      console.log('WebSocket 连接关闭');
    });
  },

  closeWebSocket() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  },

  handleOrderUpdate(order) {
    console.log('处理订单更新:', order);
    
    if (order && order.status === 'draft') {
      const cartCount = {};
      order.order_items.forEach(item => {
        cartCount[item.dish_id] = (cartCount[item.dish_id] || 0) + item.quantity;
      });
      this.setData({ cartCount, currentOrderId: order.id });
      this.calculateTotal();
    } else if (order && (order.status === 'submitted' || order.status === 'printed' || order.status === 'unpaid')) {
      if (this.data.isAddMore) {
        return;
      }
      wx.redirectTo({
        url: `/pages/order/detail?id=${order.id}`,
      });
    } else if (order && (order.status === 'settled' || order.status === 'cancelled')) {
      // 订单已结账或取消，立即释放所有桌号资源
      this.releaseTableResources();
    }
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
      const table = await request({ url: `/tables/number/${tableNumber}`, noLoading: true });
      this.setData({ tableId: table.id, tableNumber: table.table_number });
      getApp().globalData.tableId = table.id;
      wx.setStorageSync('savedTableId', table.id);
      this.bindTable(tableNumber);
      this.initWebSocket();
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
      this.fetchCurrentOrder();
    } catch (err) {
      console.error('加载数据失败', err);
      wx.showToast({
        title: '加载数据失败，请重试',
        icon: 'none'
      });
    }
  },

  async fetchCurrentOrder() {
    if (!this.data.tableId || this.isFetchingOrder) return;
    this.isFetchingOrder = true;
    try {
      const order = await request({ 
        url: `/orders/current/${this.data.tableId}`,
        noLoading: true 
      });
      if (order && order.status === 'draft') {
        if (!order.order_items || order.order_items.length === 0) {
          await request({
            url: `/orders/${order.id}`,
            method: 'DELETE',
            noLoading: true
          });
          this.setData({ cartCount: {}, currentOrderId: null, orderStatus: null, totalCount: 0, totalPrice: '0.00' });
          const cart = getApp().getCart(this.data.tableId);
          cart.cartCount = {};
          cart.currentOrderId = null;
          cart.orderStatus = null;
          return;
        }
        const cartCount = {};
        order.order_items.forEach(item => {
          cartCount[item.dish_id] = (cartCount[item.dish_id] || 0) + item.quantity;
        });
        this.setData({ cartCount, currentOrderId: order.id, orderStatus: 'draft' });
        const cart = getApp().getCart(this.data.tableId);
        cart.cartCount = { ...cartCount };
        cart.currentOrderId = order.id;
        cart.orderStatus = 'draft';
        this.calculateTotal();
      } else if (order && (order.status === 'submitted' || order.status === 'printed' || order.status === 'unpaid')) {
        if (this.data.isAddMore) {
          const addMoreCart = getApp().getAddMoreCart(this.data.tableId);
          this.setData({ cartCount: { ...addMoreCart.cartCount }, currentOrderId: order.id, orderStatus: order.status });
          addMoreCart.currentOrderId = order.id;
          addMoreCart.orderStatus = order.status;
          this.calculateTotal();
          return;
        }
        wx.redirectTo({
          url: `/pages/order/detail?id=${order.id}`,
        });
      } else {
        this.setData({ cartCount: {}, currentOrderId: null, orderStatus: null, totalCount: 0, totalPrice: '0.00' });
        const cart = getApp().getCart(this.data.tableId);
        cart.cartCount = {};
        cart.currentOrderId = null;
        cart.orderStatus = null;
      }
    } catch (err) {
      console.error('获取当前订单失败', err);
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
            this.fetchCurrentOrder();
            return;
          } else {
            // 纯数字或桌台编号
            tableNumber = res.result;
          }
        }
        
        if (tableNumber) {
          this.setData({ tableNumber, hasScannedTable: true });
          this.fetchTableInfoByNumber(tableNumber);
          this.fetchCurrentOrder();
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
      wx.showModal({
        title: '提示',
        content: '请先扫描桌码再点餐',
        showCancel: false,
        confirmText: '去扫码',
        success: (res) => {
          if (res.confirm) {
            this.startScan();
          }
        }
      });
      return;
    }

    if (!getApp().globalData.userInfo) {
      wx.showModal({
        title: '提示',
        content: '请先登录后再点餐',
        confirmText: '去登录',
        cancelText: '取消',
        success: (res) => {
          if (res.confirm) {
            wx.switchTab({ url: '/pages/me/me' });
          }
        }
      });
      return;
    }

    const { id, type } = e.currentTarget.dataset;
    const { cartCount } = this.data;
    const count = cartCount[id] || 0;
    
    if (type === 'plus') {
      cartCount[id] = count + 1;
    } else {
      cartCount[id] = Math.max(0, count - 1);
    }

    this.setData({ cartCount });
    const cart = this.data.isAddMore ? getApp().getAddMoreCart(this.data.tableId) : getApp().getCart(this.data.tableId);
    cart.cartCount = { ...cartCount };
    this.calculateTotal();
    this.syncCartToBackend();
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
  },

  async syncCartToBackend() {
    const { cartCount, allDishes, tableId, currentOrderId, isAddMore } = this.data;
    if (!tableId) return;
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
      if (currentOrderId) {
        const { orderStatus } = this.data;
        if (orderStatus === 'draft') {
          await request({
            url: `/orders/${currentOrderId}`,
            method: 'DELETE',
            noLoading: true
          });
        }
        this.setData({ cartCount: {}, currentOrderId: null, orderStatus: null, totalCount: 0, totalPrice: '0.00' });
        if (isAddMore) {
          getApp().clearAddMoreCart(this.data.tableId);
        } else {
          getApp().clearCart(this.data.tableId);
        }
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
        if (currentOrderId && (orderStatus === 'submitted' || orderStatus === 'printed')) {
          await request({
            url: `/orders/${currentOrderId}/sync-add-more`,
            method: 'POST',
            data: { items },
            noLoading: true
          });
        } else {
          await request({
            url: '/orders/sync-draft',
            method: 'POST',
            data: {
              table_id: parseInt(tableId),
              items: items,
              user_id: getApp().globalData.userInfo?.id
            },
            noLoading: true
          });
        }
      }
    } catch (err) {
      console.error('同步购物车失败', err);
    }
  },

  goToCart() {
    wx.navigateTo({
      url: `/pages/order/cart?tableId=${this.data.tableId}&tableNumber=${this.data.tableNumber}&isAddMore=${this.data.isAddMore}`,
    });
  },

  goToConfirm() {
    if (this.data.isAddMore) {
      wx.showModal({
        title: '确认提交加餐',
        content: `共${this.data.totalCount}件菜品，合计¥${this.data.totalPrice}，确认提交？`,
        success: (res) => {
          if (res.confirm) {
            this.submitAddMore();
          }
        }
      });
    } else {
      wx.navigateTo({
        url: `/pages/order/confirm?tableId=${this.data.tableId}`,
      });
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
        wx.redirectTo({
          url: `/pages/order/detail?id=${result.id}`,
        });
      }, 1500);
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '提交失败', icon: 'none' });
      console.error('提交加餐失败', err);
    }
  }
})
