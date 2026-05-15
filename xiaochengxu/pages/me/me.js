// pages/me/me.js
const { request } = require('../../utils/request');

Page({
  data: {
    userInfo: null,
    orders: [],
    statusMap: {
      'submitted': '待接单',
      'printed': '制作中',
      'settled': '已结账',
      'cancelled': '已取消',
      'refunded': '已退款'
    }
  },

  onShow() {
    this.setData({
      userInfo: getApp().globalData.userInfo
    });
    this.fetchOrders();
  },

  async fetchOrders() {
    try {
      // 假设后端有按用户获取订单的接口
      const orders = await request({ url: '/orders' });
      // 过滤出当前用户的订单
      const myOrders = orders.filter(o => o.user_id === this.data.userInfo?.id && o.status !== 'draft');
      this.setData({ orders: myOrders });
    } catch (err) {
      console.error('获取订单列表失败', err);
    }
  },

  goToDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/order/detail?id=${id}`,
    });
  }
})
