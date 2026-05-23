// components/confirm-sheet/index.js
// "确认订单"全屏弹窗：业务逻辑与 pages/order/confirm.js 完全一致
const { request } = require('../../utils/request');

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
      observer(newVal) {
        if (newVal) {
          this.handleOpen();
        }
      }
    },
    tableId: {
      type: String,
      value: ''
    }
  },

  data: {
    cartId: null,
    order: null,
    previewItems: [],
    totalCount: 0,
    totalPrice: '0.00',
    peopleRange: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    peopleIndex: 0,
    remark: '',
    isSubmitting: false,
    statusBarHeight: 0,
    sheetIn: false
  },

  lifetimes: {
    attached() {
      try {
        const sysInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        this.setData({ statusBarHeight: sysInfo.statusBarHeight || 20 });
      } catch (e) {
        this.setData({ statusBarHeight: 20 });
      }
    }
  },

  methods: {
    handleOpen() {
      this.setData({
        sheetIn: false,
        // 重置每次打开的状态
        remark: '',
        peopleIndex: 0,
        isSubmitting: false
      });
      wx.nextTick(() => {
        this.setData({ sheetIn: true });
      });
      this.fetchCurrentCartPreview();
    },

    onClose() {
      this.setData({ sheetIn: false });
      setTimeout(() => {
        this.triggerEvent('close');
      }, 220);
    },

    // ====== 以下方法逐字迁移自 pages/order/confirm.js（业务零修改） ======

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
        // 关闭 sheet 并通知父级跳转到订单详情
        this.triggerEvent('submitted', { orderId: result.id });
        this.setData({ sheetIn: false });
        setTimeout(() => {
          this.triggerEvent('close');
        }, 220);

        // 清理服务端购物车（best-effort，失败不影响主流程）
        const cartId = this.data.cartId || cart.currentCartId;
        if (cartId) {
          request({
            url: `/carts/${cartId}`,
            method: 'DELETE',
            noLoading: true
          }).catch(() => {});
        }
      } catch (err) {
        console.error('提交订单失败', err);
        wx.showToast({ title: '提交失败', icon: 'none' });
      } finally {
        this.setData({ isSubmitting: false });
      }
    }
  }
});
