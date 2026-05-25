// pages/confirm/confirm.js
// 确认订单真页面：从 components/confirm-sheet/index.js 1:1 迁移业务逻辑
// 唯一变化：properties.tableId → onLoad(options.tableId)；triggerEvent → wx.navigateTo
const { request } = require('../../utils/request');

Page({
  data: {
    tableId: '',
    cartId: null,
    order: { order_items: [], total_amount: '0.00' },
    previewItems: [],
    totalCount: 0,
    totalPrice: '0.00',
    peopleRange: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    peopleIndex: 0,
    remark: '',
    isSubmitting: false,
    statusBarHeight: 0,
    fromReorder: false
  },

  onLoad(options) {
    try {
      const sysInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.setData({ statusBarHeight: sysInfo.statusBarHeight || 20 });
    } catch (e) {
      this.setData({ statusBarHeight: 20 });
    }

    const tableId = String(options.tableId || '');
    const fromReorder = options.fromReorder === '1';
    this.setData({ tableId, fromReorder });

    this.fetchCurrentCartPreview();
  },

  onBack() {
    wx.navigateBack().catch(() => {
      wx.switchTab({ url: '/pages/order/order' });
    });
  },

  /**
   * 客户端预校验：必选菜品 + 最少数量
   * 后端有同样校验做兜底（防绕过），这里只是提早拦下避免空跑请求 + 给具体引导
   */
  _validateRequiredAndMinQty(items, allDishes) {
    const qtyByDishId = new Map();
    for (const it of items) {
      qtyByDishId.set(it.dish_id, (qtyByDishId.get(it.dish_id) || 0) + (it.quantity || 0));
    }
    const dishMap = new Map(allDishes.map(d => [d.id, d]));
    const minViolations = [];
    for (const [dishId, qty] of qtyByDishId) {
      const d = dishMap.get(dishId);
      if (!d) continue;
      const minQ = Number(d.min_quantity || 1);
      if (minQ > 1 && qty < minQ) {
        minViolations.push({ id: dishId, name: d.name, required: minQ, actual: qty });
      }
    }
    if (minViolations.length > 0) {
      const detail = minViolations
        .map(v => `${v.name}（至少 ${v.required} 份，当前 ${v.actual} 份）`)
        .join('\n');
      return {
        ok: false,
        title: '部分菜品数量不够',
        content: detail,
        firstMissingDishId: minViolations[0].id,
      };
    }

    const orderDishIdSet = new Set(items.map(it => it.dish_id));
    const required = allDishes.filter(d =>
      d && d.is_required && d.status === 'available'
    );
    const missing = required.filter(d => !orderDishIdSet.has(d.id));
    if (missing.length > 0) {
      return {
        ok: false,
        title: '请先点必选菜品',
        content: missing.map(m => `· ${m.name}`).join('\n'),
        firstMissingDishId: missing[0].id,
      };
    }

    return { ok: true };
  },

  async fetchCurrentCartPreview() {
    try {
      const cart = await request({
        url: `/carts/current/${this.data.tableId}`,
        noLoading: true
      });

      if (cart && cart.cart_items && cart.cart_items.length > 0) {
        this.buildOrderFromCartItems(cart);
        this.setData({ cartId: cart.id });
        const localCart = getApp().getCart(this.data.tableId);
        localCart.currentCartId = cart.id;
        return;
      }
    } catch (err) {
      console.error('获取购物车失败', err);
    }

    this.buildOrderFromLocalCart();
  },

  buildOrderFromCartItems(cart) {
    const allDishes = getApp().globalData.allDishes || [];
    const items = [];
    let totalCount = 0;
    let totalPrice = 0;

    cart.cart_items.forEach(item => {
      const dish = allDishes.find(d => d.id == item.dish_id);
      const subtotal = parseFloat(item.subtotal).toFixed(2);
      items.push({
        id: item.dish_id,
        dish_name: item.dish_name,
        price: parseFloat(item.price).toFixed(2),
        quantity: item.quantity,
        subtotal: subtotal,
        image_url: dish?.image_url || ''
      });
      totalCount += item.quantity;
      totalPrice += parseFloat(item.subtotal);
    });

    const order = {
      order_items: items,
      total_amount: totalPrice.toFixed(2)
    };

    this.setData({
      previewItems: items,
      totalCount,
      totalPrice: totalPrice.toFixed(2),
      order
    });
  },

  buildOrderFromLocalCart() {
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

    const order = {
      order_items: items,
      total_amount: totalPrice.toFixed(2)
    };

    this.setData({
      previewItems: items,
      totalCount,
      totalPrice: totalPrice.toFixed(2),
      order
    });
  },

  onPeopleChange(e) {
    this.setData({ peopleIndex: e.detail.value });
  },

  onRemarkInput(e) {
    this.setData({ remark: e.detail.value });
  },

  async submitOrder() {
    if (this.data.isSubmitting) return;
    if (!this.data.previewItems || this.data.previewItems.length === 0) {
      wx.showToast({ title: '请选择菜品', icon: 'none' });
      return;
    }

    this.setData({ isSubmitting: true });
    try {
      const app = getApp();
      const cart = app.getCart(this.data.tableId);
      const cartCount = cart.cartCount || {};
      const allDishes = app.globalData.allDishes || [];
      const items = [];
      const userInfo = app.globalData.userInfo;

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

      // 客户端预校验：必选菜品 + 最少数量
      const validation = this._validateRequiredAndMinQty(items, allDishes);
      if (!validation.ok) {
        wx.showModal({
          title: validation.title,
          content: validation.content,
          confirmText: '去选择',
          cancelText: '取消',
          success: (res) => {
            if (res.confirm) {
              // 关闭确认页 → 回到 order 页 → 由 order 页接收 focusdish 信号定位到第一个待补菜品
              if (validation.firstMissingDishId) {
                const app = getApp();
                if (app && app.globalData) {
                  app.globalData.focusDishId = validation.firstMissingDishId;
                }
              }
              wx.navigateBack().catch(() => {
                wx.switchTab({ url: '/pages/order/order' });
              });
            }
          }
        });
        this.setData({ isSubmitting: false });
        return;
      }

      const result = await request({
        url: '/orders',
        method: 'POST',
        data: {
          table_id: parseInt(this.data.tableId),
          items: items,
          user_id: userInfo?.id,
          remark: this.data.remark,
        },
        loading: true,
        loadingTitle: '提交中...'
      });

      // 订单创建成功，立即清理本地状态并跳转
      app.clearCart(this.data.tableId);
      this.setData({ cartId: null });

      wx.showToast({ title: '下单成功' });

      // 清理服务端购物车（best-effort，失败不影响主流程）
      const cartId = this.data.cartId || cart.currentCartId;
      if (cartId) {
        request({
          url: `/carts/${cartId}`,
          method: 'DELETE',
          noLoading: true
        }).catch(() => {});
      }

      // 跳到 detail 真页面（锁定模式：强制完成订单），用 redirectTo 避免栈深
      setTimeout(() => {
        wx.redirectTo({ url: `/pages/detail/detail?orderId=${result.id}&locked=1` });
      }, 300);
    } catch (err) {
      console.error('提交订单失败', err);
      const data = err && (err.data || err);
      const code = data && data.code;
      if (code === 'REQUIRED_DISH_MISSING') {
        const missing = (data.missing || []).map(m => `· ${m.name}`).join('\n');
        wx.showModal({
          title: '请先点必选菜品',
          content: missing || '订单缺少必选菜品',
          confirmText: '去选择',
          showCancel: false,
          success: () => {
            wx.navigateBack().catch(() => {
              wx.switchTab({ url: '/pages/order/order' });
            });
          }
        });
      } else if (code === 'MIN_QUANTITY_NOT_MET') {
        const detail = (data.violations || [])
          .map(v => `${v.name}（至少 ${v.required} 份，当前 ${v.actual} 份）`)
          .join('\n');
        wx.showModal({
          title: '部分菜品数量不够',
          content: detail,
          confirmText: '去调整',
          showCancel: false,
          success: () => {
            wx.navigateBack().catch(() => {
              wx.switchTab({ url: '/pages/order/order' });
            });
          }
        });
      } else {
        wx.showToast({ title: '提交失败', icon: 'none' });
      }
    } finally {
      this.setData({ isSubmitting: false });
    }
  }
});
