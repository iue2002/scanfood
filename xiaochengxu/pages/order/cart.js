// pages/order/cart.js
const { request, serverURL } = require('../../utils/request');
const config = require('../../config');

Page({
  data: {
    tableId: '',
    tableNumber: '',
    cartItems: [],
    totalCount: 0,
    totalPrice: '0.00',
    orderStatus: null,
    ws: null
  },

  onLoad(options) {
    const tableId = options.tableId || getApp().globalData.tableId;
    const tableNumber = options.tableNumber || '';
    this.setData({ tableId, tableNumber });
    this.initWebSocket();
  },

  onShow() {
    if (!getApp().globalData.userInfo) {
      wx.showModal({
        title: '提示',
        content: '请先登录后再查看购物车',
        confirmText: '去登录',
        cancelText: '返回',
        success: (res) => {
          if (res.confirm) {
            wx.switchTab({ url: '/pages/me/me' });
          } else {
            wx.navigateBack();
          }
        }
      });
      return;
    }
    this.loadCartFromGlobal();
  },

  onUnload() {
    this.closeWebSocket();
    const app = getApp();
    const cart = app.getCart(this.data.tableId);
    const cartCount = cart.cartCount || {};
    const hasItems = Object.values(cartCount).some(count => count > 0);

    if (!hasItems && cart.currentOrderId && cart.orderStatus === 'draft') {
      wx.request({
        url: `${config.baseURL}/orders/${cart.currentOrderId}`,
        method: 'DELETE',
        header: {
          'Authorization': `Bearer ${wx.getStorageSync('token')}`
        },
        timeout: 5000
      });
      app.clearCart(this.data.tableId);
    }
  },

  loadCartFromGlobal() {
    const app = getApp();
    const cart = app.getCart(this.data.tableId);
    const cartCount = cart.cartCount || {};
    const allDishes = app.globalData.allDishes || [];
    const items = [];
    let totalCount = 0;
    let totalPrice = 0;

    for (const id in cartCount) {
      const count = cartCount[id];
      if (count > 0) {
        const dish = allDishes.find(d => d.id == id);
        if (dish) {
          const subtotal = (count * parseFloat(dish.price)).toFixed(2);
          items.push({
            id: dish.id,
            dish_name: dish.name,
            price: parseFloat(dish.price).toFixed(2),
            quantity: count,
            subtotal: subtotal,
            image_url: dish.image_url || ''
          });
          totalCount += count;
          totalPrice += count * parseFloat(dish.price);
        }
      }
    }

    this.setData({
      cartItems: items,
      totalCount,
      totalPrice: totalPrice.toFixed(2),
      orderStatus: cart.orderStatus || null
    });
  },

  initWebSocket() {
    if (!serverURL) return;
    const wsUrl = serverURL.replace('http', 'ws').replace('https', 'wss') + '/ws';
    console.log('购物车连接 WebSocket:', wsUrl);
    this.ws = wx.connectSocket({
      url: wsUrl,
      success: () => { console.log('购物车 WebSocket 连接成功'); },
      fail: (err) => { console.error('购物车 WebSocket 连接失败', err); }
    });

    this.ws.onOpen(() => {
      this.ws.send({
        data: JSON.stringify({ event: 'subscribeTable', data: { tableId: parseInt(this.data.tableId) } })
      });
    });

    this.ws.onMessage((res) => {
      const message = JSON.parse(res.data);
      if (message.event === 'orderUpdated' || message.event === 'orderStatusChanged') {
        this.loadCartFromGlobal();
      }
    });

    this.ws.onClose(() => {
      console.log('购物车 WebSocket 连接关闭');
    });
  },

  closeWebSocket() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  },

  updateQuantity(e) {
    const { id, type } = e.currentTarget.dataset;
    const app = getApp();
    const cart = app.getCart(this.data.tableId);
    const cartCount = cart.cartCount;
    const count = cartCount[id] || 0;

    if (type === 'plus') {
      cartCount[id] = count + 1;
    } else {
      if (count <= 1) {
        wx.showModal({
          title: '提示',
          content: '确定要移除该菜品吗？',
          success: (res) => {
            if (res.confirm) {
              delete cartCount[id];
              cart.cartCount = cartCount;
              this.loadCartFromGlobal();
              this.syncCartToBackend();
            }
          }
        });
        return;
      }
      cartCount[id] = count - 1;
    }

    cart.cartCount = cartCount;
    this.loadCartFromGlobal();
    this.syncCartToBackend();
  },

  clearCart() {
    wx.showModal({
      title: '提示',
      content: '确定要清空购物车吗？',
      success: (res) => {
        if (res.confirm) {
          getApp().clearCart(this.data.tableId);
          this.setData({ cartItems: [], totalCount: 0, totalPrice: '0.00' });
          this.syncCartToBackend();
        }
      }
    });
  },

  async syncCartToBackend() {
    const { tableId } = this.data;
    if (!tableId) return;

    const app = getApp();
    const cart = app.getCart(tableId);
    const cartCount = cart.cartCount;
    const allDishes = app.globalData.allDishes || [];
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
      const currentOrderId = cart.currentOrderId;
      const orderStatus = cart.orderStatus;

      if (items.length === 0) {
        if (currentOrderId && orderStatus === 'draft') {
          await request({
            url: `/orders/${currentOrderId}`,
            method: 'DELETE',
            noLoading: true
          });
        }
        getApp().clearCart(this.data.tableId);
        this.setData({ cartItems: [], totalCount: 0, totalPrice: '0.00', orderStatus: null });
        return;
      }

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
            user_id: app.globalData.userInfo?.id
          },
          noLoading: true
        });
      }
    } catch (err) {
      console.error('同步购物车失败', err);
    }
  },

  goToConfirm() {
    wx.navigateTo({
      url: `/pages/order/confirm?tableId=${this.data.tableId}`,
    });
  },

  async goBack() {
    await this.syncCartToBackend();
    wx.navigateBack();
  }
});
