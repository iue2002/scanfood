// pages/order/list.js
const { request } = require('../../utils/request');

Page({
  data: {
    userInfo: null,
    orders: [],
    filteredOrders: [],
    currentTab: 'all',
    statusMap: {
      'draft': '待提交',
      'submitted': '已提交',
      'printed': '已下单',
      'settled': '已结账',
      'cancelled': '已取消',
      'refunded': '已退款'
    },
    isLoading: false
  },

  onShow() {
    this.loadUserInfo();
    this.fetchOrders();
  },

  async onPullDownRefresh() {
    console.log('下拉刷新 - 重新加载订单列表');
    try {
      await this.fetchOrders();
      wx.stopPullDownRefresh();
    } catch (err) {
      console.error('下拉刷新失败', err);
      wx.stopPullDownRefresh();
    }
  },

  loadUserInfo() {
    const app = getApp();
    const token = wx.getStorageSync('token');
    const backendUser = wx.getStorageSync('userInfo');
    
    if (token && backendUser && backendUser.id) {
      this.setData({ userInfo: backendUser });
      app.globalData.userInfo = backendUser;
      app.globalData.token = token;
    }
  },

  async fetchOrders() {
    if (this.data.isLoading) return;
    this.setData({ isLoading: true });
    
    try {
      const userInfo = this.data.userInfo;
      const { SERVER_URL } = require('../../config');
      
      if (!userInfo || !userInfo.id) {
        console.warn('用户信息未加载，无法获取订单');
        this.setData({ isLoading: false });
        return;
      }
      
      const result = await request({ url: '/orders' });
      const orders = result?.data || [];
      const store_name = result?.store_name;
      const store_avatar = result?.store_avatar;
      const dishes = await request({ url: '/dishes', noLoading: true });
      
      const myOrders = orders
        .filter(o => o.user_id === userInfo.id && o.status !== 'draft')
        .map(order => {
          if (order.created_at) {
            order.created_at = this.formatDate(order.created_at);
          }
          
          if (order.order_items) {
            order.order_items = order.order_items.map(item => {
              const dish = dishes.find(d => d.id === item.dish_id);
              let dishImage = '';
              if (dish && dish.image_url) {
                if (dish.image_url.startsWith('http')) {
                  dishImage = dish.image_url;
                } else {
                  dishImage = SERVER_URL + (dish.image_url.startsWith('/') ? '' : '/') + dish.image_url;
                }
              }
              return { ...item, dish_image: dishImage };
            });

            // 按菜品名称聚合数量，用于列表卡片展示
            const dishMap = new Map();
            for (const item of order.order_items) {
              const key = item.dish_name;
              if (dishMap.has(key)) {
                dishMap.get(key).quantity += Number(item.quantity) || 1;
              } else {
                dishMap.set(key, {
                  dish_name: item.dish_name,
                  dish_image: item.dish_image,
                  quantity: Number(item.quantity) || 1
                });
              }
            }
            const aggregatedItems = Array.from(dishMap.values());

            order.itemImages = aggregatedItems.slice(0, 2).map(item => item.dish_image);
            order.itemNames = aggregatedItems.slice(0, 2).map(item => item.dish_name);
            order.itemQtys = aggregatedItems.slice(0, 2).map(item => item.quantity);
            order.totalItems = aggregatedItems.reduce((sum, item) => sum + item.quantity, 0);

            console.log('Order itemQtys:', order.itemQtys, 'totalItems:', order.totalItems);
          }
          
          return order;
        });
      
      this.setData({ 
        orders: myOrders, 
        isLoading: false,
        storeName: store_name || '伊美轩',
        storeAvatar: store_avatar || '',
      });
      
      this.filterOrders();
    } catch (err) {
      console.error('获取订单列表失败', err);
      this.setData({ isLoading: false });
      wx.showToast({
        title: '获取订单失败',
        icon: 'none'
      });
    }
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ currentTab: tab });
    this.filterOrders();
  },

  filterOrders() {
    const { orders, currentTab } = this.data;
    
    if (currentTab === 'all') {
      this.setData({ filteredOrders: orders });
    } else {
      let filtered;
      if (currentTab === 'submitted') {
        filtered = orders.filter(o => o.status === 'submitted' || o.status === 'printed');
      } else {
        filtered = orders.filter(o => o.status === currentTab);
      }
      this.setData({ filteredOrders: filtered });
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

  goToDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/order/detail?id=${id}`,
    });
  },

  async submitOrder(e) {
    const orderId = e.currentTarget.dataset.id;
    
    wx.showModal({
      title: '确认提交',
      content: '确定要提交此订单吗？',
      success: async (res) => {
        if (res.confirm) {
          try {
            await request({
              url: `/orders/${orderId}/status`,
              method: 'PUT',
              data: { status: 'submitted' },
              noLoading: true
            });
            
            wx.showToast({
              title: '订单已提交',
              icon: 'success'
            });
            
            this.fetchOrders();
          } catch (err) {
            console.error('提交订单失败', err);
            wx.showToast({
              title: '提交失败，请重试',
              icon: 'none'
            });
          }
        }
      }
    });
  },

  async reorder(e) {
    const orderId = e.currentTarget.dataset.id;
    const order = this.data.orders.find(o => o.id === orderId);
    
    if (!order || !order.order_items) {
      wx.showToast({ title: '无法获取订单信息', icon: 'none' });
      return;
    }
    
    wx.showModal({
      title: '再来一单',
      content: '确定要重新下单吗？',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '下单中...' });
          try {
            const items = order.order_items.map(item => ({
              dish_id: item.dish_id,
              dish_name: item.dish_name,
              price: parseFloat(item.price),
              quantity: item.quantity,
              added_by_user_id: this.data.userInfo?.id,
              added_by_nickname: this.data.userInfo?.nickname || '未知用户'
            }));
            
            const result = await request({
              url: '/orders',
              method: 'POST',
              data: {
                table_id: order.table_id,
                items: items,
                user_id: this.data.userInfo?.id
              }
            });
            
            wx.hideLoading();
            wx.showToast({ title: '下单成功', icon: 'success' });
            
            setTimeout(() => {
              wx.redirectTo({ url: `/pages/order/detail?id=${result.id}` });
            }, 1500);
          } catch (err) {
            wx.hideLoading();
            wx.showToast({ title: '下单失败', icon: 'none' });
            console.error('再来一单失败', err);
          }
        }
      }
    });
  }
})
