// pages/order/confirm.js
const { request } = require('../../utils/request');

Page({
  data: {
    tableId: '',
    order: null,
    peopleRange: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    peopleIndex: 0,
    remark: ''
  },

  onLoad(options) {
    this.setData({ tableId: options.tableId });
    this.fetchCurrentOrder();
  },

  async fetchCurrentOrder() {
    try {
      const order = await request({ url: `/orders/current/${this.data.tableId}` });
      if (order) {
        this.setData({ order });
      }
    } catch (err) {
      console.error('获取订单失败', err);
    }
  },

  onPeopleChange(e) {
    this.setData({ peopleIndex: e.detail.value });
  },

  onRemarkInput(e) {
    this.setData({ remark: e.detail.value });
  },

  async submitOrder() {
    if (!this.data.order) return;

    try {
      const result = await request({
        url: `/orders/${this.data.order.id}/status`,
        method: 'POST',
        data: {
          status: 'submitted',
          remark: this.data.remark, // 这里可以扩展后端接口支持在修改状态时同时修改备注
          // 用餐人数可以作为备注的一部分，或者扩展后端字段
        }
      });
      
      wx.showToast({ title: '下单成功' });
      wx.redirectTo({
        url: `/pages/order/detail?id=${this.data.order.id}`,
      });
    } catch (err) {
      console.error('提交订单失败', err);
    }
  }
})
