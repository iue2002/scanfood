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
    ws: null
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
    getApp().globalData.addMore = true;
    wx.switchTab({
      url: '/pages/order/order'
    });
  }
})
