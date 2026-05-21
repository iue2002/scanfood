// pages/me/me.js
const { request } = require('../../utils/request');

Page({
  data: {
    userInfo: null,
    isLoading: false,
    showAuthModal: false,
    showNicknameModal: false,
    tempAvatarUrl: '',
    tempNickname: '',
    // === 仅 UI：头像加载失败标记 ===
    avatarError: false
  },

  onShow() {
    this.setData({ isLoading: false });
    this.loadUserInfo();
    this.updateTabBar();
  },

  async onPullDownRefresh() {
    console.log('下拉刷新 - 重新加载用户信息');
    try {
      this.loadUserInfo();
      wx.stopPullDownRefresh();
    } catch (err) {
      console.error('下拉刷新失败', err);
      wx.stopPullDownRefresh();
    }
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
      this.setData({ userInfo: backendUser, avatarError: false });
      app.globalData.userInfo = backendUser;
      app.globalData.token = token;
    }
  },

  // === 仅 UI：image 加载失败时切换到字母占位 ===
  onAvatarError() {
    this.setData({ avatarError: true });
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
      
      console.log('=== 开始微信登录流程 ===');
      const loginRes = await wx.login();
      console.log('wx.login 结果:', loginRes);
      
      if (!loginRes.code) {
        throw new Error('获取登录code失败: ' + loginRes.errMsg);
      }

      console.log('准备发送请求到服务端, code:', loginRes.code.substring(0, 10) + '...');
      const requestData = { 
        code: loginRes.code,
        nickname: nickname,
        avatar_url: avatarUrl
      };
      console.log('请求数据:', requestData);

      const loginData = await request({
        url: '/auth/wechat-login',
        method: 'POST',
        data: requestData,
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
      console.error('错误详情:', JSON.stringify(err, null, 2));
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
