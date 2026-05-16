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
    ws: null,
    showAddMoreModal: false,
    categories: [],
    currentCategory: '',
    allDishes: [],
    dishes: [],
    addMoreCartCount: {},
    addMoreTotal: 0,
    cartItemCount: 0,
    addMoreTotalStr: '0.00'
  },

  onLoad(options) {
    this.fetchOrderDetail(options.id);
    this.initWebSocket(options.id);
  },

  onUnload() {
    this.closeWebSocket();
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
      }

      if (order.created_at) {
        order.created_at = this.formatDate(order.created_at);
      }
      if (order.settled_at) {
        order.settled_at = this.formatDate(order.settled_at);
      }

      this.setData({ order });
    } catch (err) {
      console.error('获取订单详情失败', err);
    }
  },

  initWebSocket(orderId) {
    if (!SERVER_URL) return;

    const wsUrl = SERVER_URL.replace('http', 'ws').replace('https', 'wss') + '/ws';
    console.log('订单详情连接 WebSocket:', wsUrl);

    this.ws = wx.connectSocket({
      url: wsUrl,
      success: () => { console.log('订单详情 WebSocket 连接成功'); },
      fail: (err) => { console.error('订单详情 WebSocket 连接失败', err); }
    });

    this.ws.onOpen(() => {
      this.ws.send({
        data: JSON.stringify({ event: 'subscribeOrder', data: { orderId } })
      });
    });

    this.ws.onMessage((res) => {
      const message = JSON.parse(res.data);
      if (message.event === 'orderUpdated' || message.event === 'orderStatusChanged') {
        this.fetchOrderDetail(orderId);
      }
    });

    this.ws.onError((err) => {
      console.error('订单详情 WebSocket 错误', err);
    });
  },

  closeWebSocket() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
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
    for (const id in addMoreCartCount) {
      const count = addMoreCartCount[id];
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
  }
})
