// pages/orders-list/orders-list.js
// 订单列表真页面：从 components/orders-sheet/index.js 1:1 迁移业务逻辑
// 唯一变化：组件 properties → 页面 onLoad；triggerEvent → wx.navigateTo
const { request } = require('../../utils/request');
const dishesCache = require('../../utils/dishes-cache');
const ordersPrefetch = require('../../utils/orders-prefetch');

Page({
  data: {
    userInfo: null,
    orders: [],
    filteredOrders: [],
    currentTab: 'all',
    statusMap: {
      'draft': '待提交',
      'submitted': '已提交',
      'printed': '已提交',
      'settled': '已完成',
      'cancelled': '已取消',
      'refunded': '已取消'
    },
    isLoading: false,
    expandedMap: {},
    statusBarHeight: 0,
    page: 1,
    pageSize: 20,
    hasMore: true,
    isLoadingMore: false,
    storeInfo: null,
    _refreshing: false
  },

  _isFetching: false,
  _isLoadingMore: false,

  onLoad() {
    try {
      const sysInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.setData({ statusBarHeight: sysInfo.statusBarHeight || 20 });
    } catch (e) {
      this.setData({ statusBarHeight: 20 });
    }

    // 订阅店铺信息变更
    try {
      const app = getApp();
      if (app && typeof app.subscribeStoreInfo === 'function') {
        this._unsubscribeStoreInfo = app.subscribeStoreInfo((info) => {
          if (info && info.store_name) {
            const letter = (info.store_name || '').charAt(0).toUpperCase();
            this.setData({ storeInfo: { ...info, store_name_letter: letter } });
          }
        });
      }
    } catch (e) { /* ignore */ }

    // 立即从 globalData 读取（启动时已预加载）
    const app = getApp();
    const storeInfo = app && app.globalData && app.globalData.storeInfo;
    if (storeInfo && storeInfo.store_name) {
      const letter = (storeInfo.store_name || '').charAt(0).toUpperCase();
      this.setData({ storeInfo: { ...storeInfo, store_name_letter: letter } });
    }

    // 加载用户信息 + 拉订单
    // loadUserInfo 内部 setData 是异步的，data.userInfo 可能还是 null，
    // 所以 loadUserInfo 直接返回用户对象，根据返回值决定是否拉订单
    const user = this.loadUserInfo();
    if (user && user.id) {
      this.fetchOrders(true);
    }
  },

  onShow() {
    // 隐藏底部 TabBar（订单列表是 navigateTo 进入的非 TabBar 页面，
    // 自定义 TabBar 不会自动隐藏，需要手动 hide 否则底部会有空白挡板挡住内容）
    this._hideTabBar();
  },

  _hideTabBar() {
    try {
      const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
      if (tabBar && tabBar.setHidden) {
        tabBar.setHidden(true);
      }
    } catch (e) { /* ignore */ }
  },

  onUnload() {
    if (this._unsubscribeStoreInfo) {
      try { this._unsubscribeStoreInfo(); } catch (e) { /* ignore */ }
      this._unsubscribeStoreInfo = null;
    }
  },

  onBack() {
    wx.navigateBack().catch(() => {
      // 兜底：栈中无上级时切到首页
      wx.switchTab({ url: '/pages/order/order' });
    });
  },

  loadUserInfo() {
    const app = getApp();
    const token = wx.getStorageSync('token');
    const backendUser = wx.getStorageSync('userInfo');
    if (token && backendUser && backendUser.id) {
      if (!this.data.userInfo || this.data.userInfo.id !== backendUser.id) {
        this.setData({ userInfo: backendUser });
      }
      app.globalData.userInfo = backendUser;
      app.globalData.token = token;
      return backendUser;
    }
    return null;
  },

  async fetchOrders(isRefresh) {
    if (isRefresh) {
      if (this._isFetching) return;
      this._isFetching = true;
      const patch = { page: 1, hasMore: true };
      if (this.data.orders.length === 0 && !this.data.isLoading) {
        patch.isLoading = true;
      }
      this.setData(patch);
    } else {
      if (this._isLoadingMore || !this.data.hasMore) return;
      this._isLoadingMore = true;
      this.setData({ isLoadingMore: true });
    }

    try {
      // 优先用 data，兜底从 storage 读（避免 setData 异步导致首次拉取时 data.userInfo 还是 null）
      let userInfo = this.data.userInfo;
      if (!userInfo || !userInfo.id) {
        userInfo = wx.getStorageSync('userInfo');
      }
      const { SERVER_URL } = require('../../config');
      if (!userInfo || !userInfo.id) {
        this._isFetching = false;
        this._isLoadingMore = false;
        if (this.data.isLoading || this.data.isLoadingMore) {
          this.setData({ isLoading: false, isLoadingMore: false });
        }
        return;
      }

      const page = isRefresh ? 1 : this.data.page + 1;
      const pageSize = this.data.pageSize;

      let dishes;
      let result;
      const prefetched = isRefresh && page === 1 ? await ordersPrefetch.consume() : null;
      if (prefetched && prefetched.ordersResult) {
        result = prefetched.ordersResult;
        dishes = prefetched.dishes || [];
      } else {
        const parallel = await Promise.all([
          dishesCache.getDishes(),
          request({
            url: `/orders?page=${page}&page_size=${pageSize}&exclude_draft=true`,
            noLoading: true
          })
        ]);
        dishes = parallel[0];
        result = parallel[1];
      }
      const orders = result?.data || [];

      const myNewOrders = orders
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
            order.groupedItems = this.groupItemsByPhase(order.order_items);
          }
          order.tableNumber =
            (order.tables && order.tables.table_number) ||
            order.table_number ||
            order.table_id || '';
          order.summaryText = (order.order_items && order.order_items.length > 0)
            ? order.order_items.map(it => `${it.dish_name}×${it.quantity}`).join('，')
            : '无菜品';
          order.totalItems = (order.order_items || []).reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);
          const firstWithImage = (order.order_items || []).find(it => it.dish_image);
          order.firstDishImage = firstWithImage ? firstWithImage.dish_image : '';
          return order;
        });

      const merged = isRefresh ? myNewOrders : [...this.data.orders, ...myNewOrders];
      const hasMore = orders.length >= pageSize;

      this.setData({
        orders: merged,
        page,
        hasMore,
        isLoading: false,
        isLoadingMore: false
      });
      this._isFetching = false;
      this._isLoadingMore = false;
      this.filterOrders();
    } catch (err) {
      console.error('获取订单列表失败', err);
      this._isFetching = false;
      this._isLoadingMore = false;
      this.setData({ isLoading: false, isLoadingMore: false });
      wx.showToast({ title: '获取订单失败', icon: 'none' });
    }
  },

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

  formatGroupTime(dateStr) {
    if (!dateStr) return '';
    const m = String(dateStr).match(/^\d{4}-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})/);
    if (m) return `${parseInt(m[1])}月${parseInt(m[2])}日 ${m[3]}:${m[4]}`;
    return dateStr;
  },

  toggleExpand(e) {
    const id = e.currentTarget.dataset.id;
    const expandedMap = { ...this.data.expandedMap };
    expandedMap[id] = !expandedMap[id];
    this.setData({ expandedMap });
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (this.data.currentTab === tab) return;
    this.setData({ currentTab: tab });
    this.filterOrders();
  },

  filterOrders() {
    const { orders, currentTab } = this.data;
    if (currentTab === 'all') {
      this.setData({ filteredOrders: orders });
      return;
    }
    let filtered;
    if (currentTab === 'submitted') {
      filtered = orders.filter(o => o.status === 'submitted' || o.status === 'printed');
    } else if (currentTab === 'settled') {
      filtered = orders.filter(o => o.status === 'settled' || o.status === 'refunded');
    } else {
      filtered = orders.filter(o => o.status === currentTab);
    }
    this.setData({ filteredOrders: filtered });
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
    // 跳转到详情真页面（栈式 navigateTo，按返回键自动 pop 回订单列表）
    wx.navigateTo({ url: `/pages/detail/detail?orderId=${id}` });
  },

  onScrolltolower() {
    if (!this.data.hasMore || this._isLoadingMore || this._isFetching) return;
    this.fetchOrders(false);
  },

  async onScrollRefresh() {
    this.setData({ _refreshing: true });
    try {
      dishesCache.refreshInBackground();
      await this.fetchOrders(true);
    } catch (e) { /* noop */ }
    this.setData({ _refreshing: false });
  },

  // 再来一单
  async reorder(e) {
    const orderId = e.currentTarget.dataset.id;
    const order = this.data.orders.find(o => o.id === orderId);
    if (!order || !order.order_items) {
      wx.showToast({ title: '无法获取订单信息', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '提示',
      content: '请先扫描桌号二维码，获取当前桌号',
      confirmText: '立即扫码',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          this.scanTableCode(order.order_items);
        }
      }
    });
  },

  async scanTableCode(reorderItems) {
    wx.scanCode({
      onlyFromCamera: true,
      scanType: ['qrCode'],
      success: async (res) => {
        let tableNumber = '';
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
          const table = await request({ url: `/tables/number/${tableNumber}`, noLoading: true });
          const tableId = table.id;
          const items = reorderItems.map(item => ({
            dish_id: item.dish_id,
            dish_name: item.dish_name,
            price: parseFloat(item.price) || 0,
            quantity: Number(item.quantity) || 1,
            added_by_user_id: getApp().globalData.userInfo?.id,
            added_by_nickname: getApp().globalData.userInfo?.nickname || '未知用户'
          }));
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
          // 跳到 confirm 真页面，确认订单（替代以前的 triggerEvent('reorder') + 父级 setData）
          wx.redirectTo({ url: `/pages/confirm/confirm?tableId=${tableId}&fromReorder=1` });
        } catch (err) {
          wx.hideLoading();
          console.error('再来一单处理失败', err);
          wx.showToast({ title: '处理失败，请重试', icon: 'none' });
        }
      },
      fail: (err) => {
        if (err.errMsg !== 'scanCode:fail cancel') {
          wx.showToast({ title: '扫码失败', icon: 'none' });
        }
      }
    });
  },

  preventClose() {}
});
