// components/orders-sheet/index.js
// 全屏订单列表弹窗：与原 pages/order/list 同款外观，但作为 me 页内嵌组件
// 避免 webview 创建开销，实现毫秒级打开
const { request } = require('../../utils/request');
const dishesCache = require('../../utils/dishes-cache');
const ordersPrefetch = require('../../utils/orders-prefetch');

Component({
  properties: {
    // 显示开关
    visible: {
      type: Boolean,
      value: false,
      observer(newVal) {
        if (newVal) {
          // 弹窗打开时自动加载（首次或用户主动打开）
          this.handleOpen();
        }
      }
    }
  },

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
    // 入场动画状态：visible→true 后下一帧设为 true 触发动画
    sheetIn: false
  },

  // 实例字段（不参与渲染）
  _isFetching: false,
  _isLoadingMore: false,

  lifetimes: {
    attached() {
      // 状态栏高度只算一次
      try {
        const sysInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        this.setData({ statusBarHeight: sysInfo.statusBarHeight || 20 });
      } catch (e) {
        this.setData({ statusBarHeight: 20 });
      }
    }
  },

  methods: {
    handleOpen() {
      // 触发入场动画（下一帧设为 true，让 CSS transition 生效）
      this.setData({ sheetIn: false });
      wx.nextTick(() => {
        this.setData({ sheetIn: true });
      });

      this.loadUserInfo();
      const userInfo = this.data.userInfo;
      if (userInfo && userInfo.id) {
        // 已有数据：静默后台刷新；首次：拉数据 + 显示骨架屏
        this.fetchOrders(true);
      }
    },

    onClose() {
      this.setData({ sheetIn: false });
      // 等动画结束再触发关闭事件（与 CSS transition 的 220ms 对齐）
      setTimeout(() => {
        this.triggerEvent('close');
      }, 220);
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
      }
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
        const userInfo = this.data.userInfo;
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

        // 优先消费预拉取结果；否则现拉
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
        // 已提交：包含 submitted 和 printed
        filtered = orders.filter(o => o.status === 'submitted' || o.status === 'printed');
      } else if (currentTab === 'settled') {
        // 已完成：包含 settled 和 refunded
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
      // detail 页已改为弹窗：通知父级（me-sheet → order 页）打开 detail-sheet
      // 关键：不关闭 orders-sheet 自身。detail-sheet z-index=900 直接叠在 orders-sheet (z=800) 上方，
      // 实现栈式叠加。detail-sheet 关闭后，orders-sheet 自动显露，保留滚动位置和 tab 状态，
      // 真正的"返回上一级"体验，且不会闪现下层的"我的"内容。
      this.triggerEvent('detail', { orderId: id });
    },

    // 触底加载更多（scroll-view 内部触发）
    onScrolltolower() {
      if (!this.data.hasMore || this._isLoadingMore || this._isFetching) return;
      this.fetchOrders(false);
    },

    // 下拉刷新（scroll-view 自带）
    async onRefresh() {
      try {
        dishesCache.refreshInBackground();
        await this.fetchOrders(true);
      } catch (e) { /* noop */ }
      this.setData({ _refreshing: false });
    },

    onScrollRefresh() {
      this.setData({ _refreshing: true });
      this.onRefresh();
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
            // confirm 页已改为弹窗，关掉本 sheet 后由父级（me-sheet → order 页）打开 confirm-sheet
            this.triggerEvent('reorder', { tableId });
            this.onClose();
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
  }
});
