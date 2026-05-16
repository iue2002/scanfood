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
    hasScannedTable: false
  },

  isFetchingOrder: false,
  ws: null,

  onLoad(options) {
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

    if (tableNumber) {
      this.setData({ tableNumber, hasScannedTable: true });
      this.fetchTableInfoByNumber(tableNumber);
    } else if (rawTableId) {
      const tableId = String(rawTableId).replace(/[^\d]/g, '');
      if (tableId) {
        this.setData({ tableId, hasScannedTable: true });
        this.fetchTableInfo(tableId);
        getApp().globalData.tableId = tableId; 
      }
    }
    this.fetchData();
  },

  onShow() {
    if (this.data.tableId) {
      this.fetchCurrentOrder();
    }
    this.updateTabBar();
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
    } else if (order && (order.status === 'submitted' || order.status === 'printed')) {
      wx.redirectTo({
        url: `/pages/order/detail?id=${order.id}`,
      });
    }
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
      this.initWebSocket();
    } catch (err) {
      console.error('获取桌台信息失败', err);
      wx.showToast({
        title: '获取桌台信息失败',
        icon: 'none'
      });
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
        if (dish.image_url) {
          if (!dish.image_url.startsWith('http')) {
            dish.image_url = serverURL + (dish.image_url.startsWith('/') ? '' : '/') + dish.image_url;
          }
        }
        return dish;
      });

      this.setData({
        categories,
        allDishes,
        currentCategory: categories.length > 0 ? categories[0].id : '',
        currentCategoryName: categories.length > 0 ? categories[0].name : ''
      });
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
        const cartCount = {};
        order.order_items.forEach(item => {
          cartCount[item.dish_id] = (cartCount[item.dish_id] || 0) + item.quantity;
        });
        this.setData({ cartCount, currentOrderId: order.id });
        this.calculateTotal();
      } else if (order && (order.status === 'submitted' || order.status === 'printed')) {
        wx.redirectTo({
          url: `/pages/order/detail?id=${order.id}`,
        });
      }
    } catch (err) {
      console.error('获取当前订单失败', err);
    } finally {
      this.isFetchingOrder = false;
    }
  },

  startScan() {
    wx.scanCode({
      onlyFromCamera: true,
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
          this.setData({ tableNumber });
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
    const dishes = allDishes.filter(d => d.category_id == currentCategory);
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

    const { id, type } = e.currentTarget.dataset;
    const { cartCount } = this.data;
    const count = cartCount[id] || 0;
    
    if (type === 'plus') {
      cartCount[id] = count + 1;
    } else {
      cartCount[id] = Math.max(0, count - 1);
    }

    this.setData({ cartCount });
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
    const { cartCount, allDishes, tableId } = this.data;
    if (!tableId) return;
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
            quantity: count
          });
        }
      }
    }

    try {
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
    } catch (err) {
      console.error('同步购物车失败', err);
    }
  },

  goToConfirm() {
    wx.navigateTo({
      url: `/pages/order/confirm?tableId=${this.data.tableId}`,
    });
  }
})
