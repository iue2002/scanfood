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
      
      if (!userInfo || !userInfo.id) {
        console.warn('用户信息未加载，无法获取订单');
        this.setData({ isLoading: false });
        return;
      }
      
      const orders = await request({ url: '/orders' });
      
      const myOrders = orders
        .filter(o => o.user_id === userInfo.id)
        .map(order => {
          if (order.created_at) {
            order.created_at = this.formatDate(order.created_at);
          }
          return order;
        });
      
      this.setData({ 
        orders: myOrders, 
        isLoading: false 
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
  }
})
