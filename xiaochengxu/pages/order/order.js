// pages/order/order.js
const { request } = require('../../utils/request');

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
  },

  isFetchingOrder: false, // 防止轮询重叠

  onLoad(options) {
    let rawTableId = options.tableId || getApp().globalData.tableId;
    
    // 处理微信官方小程序码扫码进入的情况 (options.scene)
    if (options.scene) {
      const scene = decodeURIComponent(options.scene);
      // 使用正则精准提取数字 ID
      const match = scene.match(/id=(\d+)/) || scene.match(/^(\d+)$/);
      rawTableId = match ? match[1] : scene;
    }

    // 确保 tableId 是纯数字字符串，防止 400 错误
    const tableId = String(rawTableId).replace(/[^\d]/g, '');

    if (tableId) {
      this.setData({ tableId });
      this.fetchTableInfo(tableId);
      getApp().globalData.tableId = tableId; 
    }
    this.fetchData();
    this.startPolling();
  },

  onUnload() {
    this.stopPolling();
  },

  async fetchTableInfo(id) {
    try {
      const table = await request({ url: `/tables/${id}`, noLoading: true });
      this.setData({ tableNumber: table.table_number });
    } catch (err) {
      console.error('获取桌台信息失败', err);
    }
  },

  async fetchData() {
    try {
      const categories = await request({ url: '/dishes/categories' });
      let allDishes = await request({ url: '/dishes' });
      
      const { serverURL } = require('../../utils/request');
      allDishes = allDishes.map(dish => {
        if (dish.image_url && !dish.image_url.startsWith('http')) {
          dish.image_url = serverURL + (dish.image_url.startsWith('/') ? '' : '/') + dish.image_url;
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
        // 已经下单，跳转到详情页
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

  startPolling() {
    this.pollingTimer = setInterval(() => {
      this.fetchCurrentOrder();
    }, 5000); 
  },

  stopPolling() {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
    }
  },

  goToMe() {
    wx.navigateTo({
      url: '/pages/me/me',
    });
  },

  startScan() {
    wx.scanCode({
      onlyFromCamera: true,
      success: (res) => {
        let tableId = '';
        if (res.result.includes('table_id=')) {
          tableId = res.result.split('table_id=')[1];
        } else {
          tableId = res.result;
        }

        if (tableId) {
          getApp().globalData.tableId = tableId;
          this.setData({ tableId });
          this.fetchTableInfo(tableId);
          this.fetchCurrentOrder(); 
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
