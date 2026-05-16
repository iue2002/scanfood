// pages/me/me.js
const { request } = require('../../utils/request');

Page({
  data: {
    userInfo: null,
    isLoading: false,
    showAuthModal: false,
    showNicknameModal: false,
    tempAvatarUrl: '',
    tempNickname: ''
  },

  onShow() {
    this.setData({ isLoading: false });
    this.loadUserInfo();
    this.updateTabBar();
  },

  updateTabBar() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
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
    } catch (err) {
      console.error('微信登录失败', err);
      this.setData({ isLoading: false });
      wx.showToast({
        title: '登录失败，请重试',
        icon: 'none'
      });
    }
  },

  goToOrders() {
    wx.navigateTo({
      url: '/pages/order/list'
    });
  }
})
