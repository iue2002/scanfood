// pages/order/cart.js
const { request, serverURL } = require('../../utils/request');

Page({
  data: {
    tableId: '',
    tableNumber: '',
    cartItems: [],
    totalCount: 0,
    totalPrice: '0.00',
    orderStatus: null,
    isAddMore: false,
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
    if (getApp().globalData.addMore) {
      getApp().globalData.addMore = false;
      this.setData({ isAddMore: true });
    }
    this.loadCartFromGlobal();
  },

  onUnload() {
    this.closeWebSocket();
  },

  loadCartFromGlobal() {
    const app = getApp();
    const cart = this.data.isAddMore ? app.getAddMoreCart(this.data.tableId) : app.getCart(this.data.tableId);
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
      if (message.event === 'cartUpdated') {
        this.loadCartFromGlobal();
      } else if (message.event === 'orderUpdated' || message.event === 'orderStatusChanged') {
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
    const cart = this.data.isAddMore ? app.getAddMoreCart(this.data.tableId) : app.getCart(this.data.tableId);
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
          if (this.data.isAddMore) {
            getApp().clearAddMoreCart(this.data.tableId);
          } else {
            getApp().clearCart(this.data.tableId);
          }
          this.setData({ cartItems: [], totalCount: 0, totalPrice: '0.00' });
          this.syncCartToBackend();
        }
      }
    });
  },

  async syncCartToBackend() {
    const { tableId, isAddMore } = this.data;
    if (!tableId) return;

    const app = getApp();
    const cart = isAddMore ? app.getAddMoreCart(tableId) : app.getCart(tableId);
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
      const currentCartId = cart.currentCartId;

      if (items.length === 0) {
        if (isAddMore) {
          getApp().clearAddMoreCart(this.data.tableId);
        } else {
          if (currentCartId) {
            await request({
              url: `/carts/${currentCartId}`,
              method: 'DELETE',
              noLoading: true
            });
          }
          getApp().clearCart(this.data.tableId);
        }
        this.setData({ cartItems: [], totalCount: 0, totalPrice: '0.00', orderStatus: null });
        return;
      }

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
              user_id: app.globalData.userInfo?.id
            },
            noLoading: true
          });
          cart.currentOrderId = result.id;
          cart.orderStatus = result.status;
          this.setData({ orderStatus: result.status });
        }
      } else {
        const result = await request({
          url: '/carts/sync',
          method: 'POST',
          data: {
            table_id: parseInt(tableId),
            items: items,
            user_id: app.globalData.userInfo?.id
          },
          noLoading: true
        });
        cart.currentCartId = result?.id || null;
        this.setData({ orderStatus: null });
      }
    } catch (err) {
      console.error('同步购物车失败', err);
    }
  },

  async goToConfirm() {
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
      await this.syncCartToBackend();
      wx.navigateTo({
        url: `/pages/order/confirm?tableId=${this.data.tableId}`,
      });
    }
  },

  async submitAddMore() {
    wx.showLoading({ title: '提交中...' });
    try {
      const app = getApp();
      const cart = app.getAddMoreCart(this.data.tableId);
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

      const result = await request({
        url: '/orders',
        method: 'POST',
        data: {
          table_id: parseInt(this.data.tableId),
          items: items,
          user_id: app.globalData.userInfo?.id
        }
      });

      app.clearAddMoreCart(this.data.tableId);
      this.setData({ cartItems: [], totalCount: 0, totalPrice: '0.00', orderStatus: null });

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
  },

  async goBack() {
    await this.syncCartToBackend();
    wx.navigateBack();
  }
});
