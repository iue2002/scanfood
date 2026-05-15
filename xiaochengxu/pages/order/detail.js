// pages/order/detail.js
const { request } = require('../../utils/request');

Page({
  data: {
    order: null,
    statusMap: {
      'submitted': '待接单',
      'printed': '制作中',
      'settled': '已结账',
      'cancelled': '已取消',
      'refunded': '已退款'
    }
  },

  onLoad(options) {
    this.fetchOrderDetail(options.id);
    this.startPolling(options.id);
  },

  onUnload() {
    this.stopPolling();
  },

  async fetchOrderDetail(id) {
    try {
      const order = await request({ url: `/orders/${id}` });
      this.setData({ order });
    } catch (err) {
      console.error('获取订单详情失败', err);
    }
  },

  startPolling(id) {
    this.pollingTimer = setInterval(() => {
      this.fetchOrderDetail(id);
    }, 5000);
  },

  stopPolling() {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
    }
  },

  goToOrder() {
    wx.navigateBack();
  }
})
