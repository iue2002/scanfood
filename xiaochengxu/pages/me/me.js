// pages/me/me.js
// 「我的」真页面：从 components/me-sheet/index.js 1:1 迁移业务逻辑
// 不再做 onShow → switchTab 重定向，让微信 TabBar 切换正常 pop 栈
const { request } = require('../../utils/request');
const ordersPrefetch = require('../../utils/orders-prefetch');

Page({
  data: {
    userInfo: null,
    isLoading: false,
    showAuthModal: false,
    chooseAvatarPending: false,
    showNicknameModal: false,
    tempAvatarUrl: '',
    tempNickname: '',
    avatarError: false,
    avatarLetter: 'U',
    statusBarHeight: 0
  },

  onLoad() {
    try {
      const sysInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.setData({ statusBarHeight: sysInfo.statusBarHeight || 20 });
    } catch (e) {
      this.setData({ statusBarHeight: 20 });
    }
    this.loadUserInfo();
  },

  onShow() {
    this.updateTabBar();
    this.loadUserInfo();
  },

  async onPullDownRefresh() {
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
      const tabBar = this.getTabBar();
      if (tabBar.setSelected) {
        tabBar.setSelected(1);
      } else if (tabBar.data && tabBar.data.selected !== 1) {
        tabBar.setData({ selected: 1 });
      }
    }
  },

  loadUserInfo() {
    const app = getApp();
    const token = wx.getStorageSync('token');
    let backendUser = wx.getStorageSync('userInfo');

    if (token && backendUser && backendUser.id) {
      if (this.isInvalidAvatarUrl(backendUser.avatar_url)) {
        console.warn('检测到失效的本地头像 URL，已清空:', backendUser.avatar_url);
        backendUser = { ...backendUser, avatar_url: '' };
        wx.setStorageSync('userInfo', backendUser);
        app.globalData.userInfo = backendUser;
      }

      const cur = this.data.userInfo;
      const same = cur
        && cur.id === backendUser.id
        && cur.nickname === backendUser.nickname
        && cur.avatar_url === backendUser.avatar_url;
      if (!same) {
        this.setData({
          userInfo: backendUser,
          avatarError: false,
          avatarLetter: this.computeAvatarLetter(backendUser)
        });
      }
      app.globalData.userInfo = backendUser;
      app.globalData.token = token;
    }
  },

  isInvalidAvatarUrl(url) {
    if (!url) return false;
    return (
      url.indexOf('__tmp__') !== -1 ||
      url.indexOf('wxfile://') === 0 ||
      url.indexOf('http://tmp/') === 0
    );
  },

  computeAvatarLetter(user) {
    if (!user) return 'U';
    const name = (user.nickname || user.nickName || '').trim();
    if (!name) return 'U';
    return name.charAt(0).toUpperCase();
  },

  onAvatarError() {
    this.setData({ avatarError: true });
  },

  showAuthModal() {
    if (this.data.userInfo) return;
    this.setData({ showAuthModal: true });
  },

  hideAuthModal() {
    this.setData({ showAuthModal: false, chooseAvatarPending: false });
  },

  hideNicknameModal() {
    this.setData({ showNicknameModal: false });
  },

  onChooseAvatar(e) {
    if (this.data.chooseAvatarPending) return;
    this.setData({ chooseAvatarPending: true });
    setTimeout(() => {
      if (this.data.chooseAvatarPending) {
        this.setData({ chooseAvatarPending: false });
      }
    }, 2000);

    const { avatarUrl } = e.detail;
    this.setData({
      tempAvatarUrl: avatarUrl,
      showAuthModal: false,
      showNicknameModal: true,
      chooseAvatarPending: false,
    });
  },

  onNicknameInputChange(e) {
    this.setData({ tempNickname: e.detail.value });
  },

  async confirmLogin() {
    const nickname = this.data.tempNickname.trim();
    const avatarUrl = this.data.tempAvatarUrl;

    if (!nickname) {
      wx.showToast({ title: '请输入昵称', icon: 'none' });
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
        throw new Error('获取登录code失败: ' + loginRes.errMsg);
      }

      const loginData = await request({
        url: '/auth/wechat-login',
        method: 'POST',
        data: {
          code: loginRes.code,
          nickname: nickname,
          avatar_url: ''
        },
        noLoading: true
      });

      let permanentAvatarUrl = '';
      if (avatarUrl) {
        try {
          permanentAvatarUrl = await this.uploadAvatar(avatarUrl, loginData.token);
        } catch (uploadErr) {
          console.warn('头像上传失败，使用昵称首字母占位', uploadErr);
        }
      }

      if (permanentAvatarUrl) {
        try {
          await request({
            url: '/auth/update-profile',
            method: 'POST',
            data: { avatar_url: permanentAvatarUrl },
            header: { Authorization: `Bearer ${loginData.token}` },
            noLoading: true
          });
        } catch (updateErr) {
          console.warn('更新头像入库失败', updateErr);
        }
      }

      const finalUser = {
        ...loginData.user,
        nickname: nickname || loginData.user.nickname,
        avatar_url: permanentAvatarUrl || loginData.user.avatar_url || ''
      };

      wx.setStorageSync('token', loginData.token);
      wx.setStorageSync('userInfo', finalUser);

      app.globalData.userInfo = finalUser;
      app.globalData.token = loginData.token;

      this.setData({
        userInfo: finalUser,
        avatarError: false,
        avatarLetter: this.computeAvatarLetter(finalUser),
        tempAvatarUrl: '',
        tempNickname: '',
        isLoading: false
      });
    } catch (err) {
      console.error('微信登录失败', err);
      this.setData({ isLoading: false });
      wx.showToast({ title: '登录失败，请重试', icon: 'none' });
    }
  },

  uploadAvatar(tempFilePath, token) {
    const config = require('../../config');
    return new Promise((resolve, reject) => {
      wx.uploadFile({
        url: `${config.baseURL}/upload/image`,
        filePath: tempFilePath,
        name: 'file',
        header: { Authorization: `Bearer ${token}` },
        success: (res) => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(res);
          }
          let data;
          try {
            data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
          } catch (e) {
            return reject(e);
          }
          if (!data || !data.url) {
            return reject(new Error('upload response missing url'));
          }
          const absoluteUrl = data.url.startsWith('http')
            ? data.url
            : config.SERVER_URL + (data.url.startsWith('/') ? '' : '/') + data.url;
          resolve(absoluteUrl);
        },
        fail: reject
      });
    });
  },

  goToOrders() {
    // 触发预拉取，让 orders-list 真页面一打开就有数据
    ordersPrefetch.prefetchFirstPage(20);
    wx.navigateTo({ url: '/pages/orders-list/orders-list' });
  }
});
