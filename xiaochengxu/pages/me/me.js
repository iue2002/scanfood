// pages/me/me.js
const { request } = require('../../utils/request');

Page({
  data: {
    userInfo: null,
    orders: [],
    statusMap: {
      'draft': '草稿',
      'submitted': '待接单',
      'printed': '制作中',
      'settled': '已结账',
      'cancelled': '已取消',
      'refunded': '已退款'
    },
    isLoading: false,
    showAuthModal: false,
    showNicknameModal: false,
    tempAvatarUrl: '',
    tempNickname: ''
  },

  onShow() {
    this.setData({ isLoading: false });
    this.loadUserInfo();
  },

  loadUserInfo() {
    const app = getApp();
    const token = wx.getStorageSync('token');
    const backendUser = wx.getStorageSync('userInfo');
    
    if (token && backendUser && backendUser.id) {
      this.setData({ userInfo: backendUser });
      app.globalData.userInfo = backendUser;
      app.globalData.token = token;
      this.fetchOrders();
    }
  },

  showAuthModal() {
    if (this.data.userInfo) return;
    this.setData({ showAuthModal: true });
  },

  hideAuthModal() {
    this.setData({ showAuthModal: false });
  },

  hideNicknameModal() {
    this.setData({ showNicknameModal: false });
  },

  onChooseAvatar(e) {
    const { avatarUrl } = e.detail;
    console.log('用户选择头像', avatarUrl);
    
    this.setData({ 
      tempAvatarUrl: avatarUrl,
      showAuthModal: false,
      showNicknameModal: true
    });
  },

  onNicknameInputChange(e) {
    this.setData({ tempNickname: e.detail.value });
  },

  async confirmLogin() {
    const nickname = this.data.tempNickname.trim();
    const avatarUrl = this.data.tempAvatarUrl;

    if (!nickname) {
      wx.showToast({
        title: '请输入昵称',
        icon: 'none'
      });
      return;
    }

    this.setData({ showNicknameModal: false });
    await this.doLogin(nickname, avatarUrl);
  },

  async doLogin(nickname, avatarUrl) {
    if (this.data.isLoading) return;
    this.setData({ isLoading: true });

    try {
      const app = getApp();
      
      const loginRes = await wx.login();
      if (!loginRes.code) {
        throw new Error('获取登录code失败');
      }

      const loginData = await request({
        url: '/auth/wechat-login',
        method: 'POST',
        data: { 
          code: loginRes.code,
          nickname: nickname,
          avatar_url: avatarUrl
        },
        noLoading: true
      });

      console.log('微信登录成功', loginData);
      
      const finalUser = {
        ...loginData.user,
        nickname: nickname || loginData.user.nickname,
        avatar_url: avatarUrl || loginData.user.avatar_url
      };
      
      wx.setStorageSync('token', loginData.token);
      wx.setStorageSync('userInfo', finalUser);
      
      app.globalData.userInfo = finalUser;
      app.globalData.token = loginData.token;

      this.setData({ 
        userInfo: finalUser,
        tempAvatarUrl: '',
        tempNickname: ''
      });

      this.setData({ isLoading: false });
      this.fetchOrders();
    } catch (err) {
      console.error('微信登录失败', err);
      this.setData({ isLoading: false });
      wx.showToast({
        title: '登录失败，请重试',
        icon: 'none'
      });
    }
  },

  updateUserProfile(userId, nickname, avatarUrl) {
    const data = {};
    if (nickname) data.nickname = nickname;
    if (avatarUrl) data.avatar_url = avatarUrl;
    
    if (Object.keys(data).length === 0) return;

    request({
      url: '/auth/update-profile',
      method: 'POST',
      data: data,
      noLoading: true
    }).then(() => {
      console.log('更新用户资料成功');
    }).catch(err => {
      console.error('更新用户资料失败（不影响使用）', err);
    });
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
        .filter(o => o.user_id === userInfo.id && o.status !== 'draft')
        .map(order => {
          if (order.created_at) {
            order.created_at = this.formatDate(order.created_at);
          }
          return order;
        });
      
      this.setData({ orders: myOrders, isLoading: false });
    } catch (err) {
      console.error('获取订单列表失败', err);
      this.setData({ isLoading: false });
      wx.showToast({
        title: '获取订单失败',
        icon: 'none'
      });
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
  }
})
