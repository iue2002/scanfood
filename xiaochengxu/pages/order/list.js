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
      'printed': '已打印',
      'settled': '已结账',
      'cancelled': '已取消',
      'refunded': '已退款'
    },
    isLoading: false,
    // === 仅 UI：展开收起的 map（按订单 id 存布尔） ===
    expandedMap: {},
    // === 仅 UI：自绘 navbar 占位 ===
    statusBarHeight: 0
  },

  onShow() {
    this.loadUserInfo();
    this.fetchOrders();
    // === 仅 UI：自绘 navbar 需要状态栏高度 ===
    if (!this.data.statusBarHeight) {
      try {
        const sysInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        this.setData({ statusBarHeight: sysInfo.statusBarHeight || 20 });
      } catch (e) {
        this.setData({ statusBarHeight: 20 });
      }
    }
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

            // 按菜品名称聚合数量，用于列表卡片展示（保留旧字段，兼容潜在依赖）
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

            // === 仅 UI：按 add_more_round 分组，复刻 admin-web groupItemsByPhase ===
            order.groupedItems = this.groupItemsByPhase(order.order_items);
          }

          // === 仅 UI：扁平字段映射，避免在 wxml 里写复杂 ?? 链 ===
          order.tableNumber =
            (order.tables && order.tables.table_number) ||
            order.table_number ||
            order.table_id || '';
          order.userNickname =
            (order.user && (order.user.nickname || order.user.username)) ||
            (order.users && (order.users.nickname || order.users.username)) ||
            '';

          // === 仅 UI：菜品摘要文案（紧凑卡片用，逗号分隔）===
          order.summaryText = (order.order_items && order.order_items.length > 0)
            ? order.order_items.map(it => `${it.dish_name}×${it.quantity}`).join('，')
            : '无菜品';

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

  // === 仅 UI：按 add_more_round 分组，逐字对齐 admin-web/OrderManage groupItemsByPhase ===
  groupItemsByPhase(items) {
    if (!items || items.length === 0) return [];
    const sorted = [...items].sort(
      (a, b) => (Number(a.add_more_round) || 0) - (Number(b.add_more_round) || 0)
    );
    const groups = [];
    let currentGroup = [sorted[0]];
    let currentRound = Number(sorted[0].add_more_round) || 0;
    const fmt = (s) => this.formatGroupTime(s);

    for (let i = 1; i < sorted.length; i++) {
      const round = Number(sorted[i].add_more_round) || 0;
      if (round === currentRound) {
        currentGroup.push(sorted[i]);
      } else {
        groups.push({
          time: fmt(currentGroup[0].created_at),
          items: currentGroup,
          label: currentRound === 0 ? '首次点餐' : `第${currentRound}次加餐`
        });
        currentGroup = [sorted[i]];
        currentRound = round;
      }
    }
    groups.push({
      time: fmt(currentGroup[0].created_at),
      items: currentGroup,
      label: currentRound === 0 ? '首次点餐' : `第${currentRound}次加餐`
    });
    return groups;
  },

  // === 仅 UI：分组标题里的简短时间 5月21日 23:44 ===
  formatGroupTime(dateStr) {
    if (!dateStr) return '';
    const m = String(dateStr).match(/^\d{4}-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})/);
    if (m) return `${parseInt(m[1])}月${parseInt(m[2])}日 ${m[3]}:${m[4]}`;
    return dateStr;
  },

  // === 仅 UI：展开收起 ===
  toggleExpand(e) {
    const id = e.currentTarget.dataset.id;
    const expandedMap = { ...this.data.expandedMap };
    expandedMap[id] = !expandedMap[id];
    this.setData({ expandedMap });
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
        // 保留原行为：'已提交' Tab 同时包含 submitted 和 printed
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

  // 再来一单功能 - 修改为提示用户扫描桌号
  async reorder(e) {
    const orderId = e.currentTarget.dataset.id;
    const order = this.data.orders.find(o => o.id === orderId);

    if (!order || !order.order_items) {
      wx.showToast({ title: '无法获取订单信息', icon: 'none' });
      return;
    }

    // 显示提示，要求用户扫描桌号
    wx.showModal({
      title: '提示',
      content: '请先扫描桌号二维码，获取当前桌号',
      confirmText: '立即扫码',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          // 调用扫码功能，传入订单菜品数据
          this.scanTableCode(order.order_items);
        }
      }
    });
  },

  // 扫描桌号功能：扫码 → 验证桌号 → 创建购物车 → 跳转确认页
  async scanTableCode(reorderItems) {
    wx.scanCode({
      onlyFromCamera: true,
      scanType: ['qrCode'],
      success: async (res) => {
        console.log('再来一单扫码结果:', res);
        let tableNumber = '';

        // 优先从 path 的 scene 参数中提取桌码号（小程序码扫码）
        if (res.path) {
          const queryStr = res.path.split('?')[1];
          if (queryStr) {
            const params = queryStr.split('&');
            for (let param of params) {
              const [key, value] = param.split('=');
              if (key === 'scene' && value) {
                tableNumber = decodeURIComponent(value).trim();
                break;
              }
            }
          }
        }

        // 如果 path 中没有，尝试从 result 中解析（普通二维码）
        if (!tableNumber && res.result) {
          if (res.result.includes('tableNumber=')) {
            tableNumber = res.result.split('tableNumber=')[1].split('&')[0];
          } else if (res.result.includes('table_id=')) {
            tableNumber = res.result.split('table_id=')[1].split('&')[0];
          } else if (res.result.includes('scene=')) {
            const sceneMatch = res.result.match(/scene=([^&]*)/);
            if (sceneMatch && sceneMatch[1]) {
              tableNumber = decodeURIComponent(sceneMatch[1]).trim();
            }
          } else {
            tableNumber = res.result.trim();
          }
        }

        if (!tableNumber) {
          wx.showToast({ title: '未能识别桌码，请重试', icon: 'none' });
          return;
        }

        wx.showLoading({ title: '处理中...' });

        try {
          // 1. 验证桌号
          const validation = await request({ url: `/tables/validate/${tableNumber}`, noLoading: true });
          if (!validation || !validation.valid) {
            wx.hideLoading();
            wx.showModal({
              title: '桌号无效',
              content: validation?.message || '该桌号不存在或已被删除，请联系服务员',
              showCancel: false,
              confirmText: '我知道了'
            });
            return;
          }

          // 2. 获取桌台信息
          const table = await request({ url: `/tables/number/${tableNumber}`, noLoading: true });
          const tableId = table.id;

          // 3. 用再来一单的菜品构建购物车数据
          const items = reorderItems.map(item => ({
            dish_id: item.dish_id,
            dish_name: item.dish_name,
            price: parseFloat(item.price) || 0,
            quantity: Number(item.quantity) || 1,
            added_by_user_id: getApp().globalData.userInfo?.id,
            added_by_nickname: getApp().globalData.userInfo?.nickname || '未知用户'
          }));

          // 4. 同步购物车到后端
          const cartResult = await request({
            url: '/carts/sync',
            method: 'POST',
            data: {
              table_id: parseInt(tableId),
              items: items,
              user_id: getApp().globalData.userInfo?.id
            },
            noLoading: true
          });

          // 5. 同步到本地购物车（确认页 fallback 使用）
          const cartCount = {};
          reorderItems.forEach(item => {
            cartCount[item.dish_id] = (cartCount[item.dish_id] || 0) + (Number(item.quantity) || 1);
          });
          const app = getApp();
          app.globalData.tableId = tableId;
          const cart = app.getCart(tableId);
          cart.cartCount = cartCount;
          cart.currentCartId = cartResult?.id || null;

          wx.hideLoading();

          // 6. 跳转到订单确认提交页
          wx.navigateTo({
            url: `/pages/order/confirm?tableId=${tableId}`
          });
        } catch (err) {
          wx.hideLoading();
          console.error('再来一单处理失败', err);
          wx.showToast({ title: '处理失败，请重试', icon: 'none' });
        }
      },
      fail: (err) => {
        console.error('扫码失败', err);
        if (err.errMsg !== 'scanCode:fail cancel') {
          wx.showToast({ title: '扫码失败', icon: 'none' });
        }
      }
    });
  }
})
