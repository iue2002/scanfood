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
    avatarError: false,
    // === 仅 UI：头像首字母占位 ===
    avatarLetter: 'U',
    // === 全屏订单弹窗开关 ===
    showOrdersSheet: false,
    // === 自绘 navbar 状态栏高度 ===
    statusBarHeight: 0
  },

  onShow() {
    // me 页已替换为 order 页内嵌的 me-sheet 弹窗
    // 任何路径进到这里（如旧版 wx.switchTab、分享卡片）都自动重定向到 order 页 + 自动展开 me-sheet
    const app = getApp();
    if (app && app.globalData) {
      app.globalData.openMeOnNextShow = true;
    }
    wx.switchTab({ url: '/pages/order/order' });
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
      // === 自愈：清掉旧的微信临时头像死链（127.0.0.1/__tmp__ 或 wxfile://） ===
      if (this.isInvalidAvatarUrl(backendUser.avatar_url)) {
        console.warn('检测到失效的本地头像 URL，已清空:', backendUser.avatar_url);
        backendUser = { ...backendUser, avatar_url: '' };
        wx.setStorageSync('userInfo', backendUser);
        app.globalData.userInfo = backendUser;
      }

      // 跟当前 data 一致就跳过 setData，避免无意义渲染
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

  // 判断是否是会失效的本地/临时 URL
  // 注意：只匹配真正的临时头像特征，避免误伤本地后端 URL（http://localhost:3000/uploads/...）
  isInvalidAvatarUrl(url) {
    if (!url) return false;
    return (
      url.indexOf('__tmp__') !== -1 ||      // 微信开发者工具内部代理临时文件
      url.indexOf('wxfile://') === 0 ||     // 微信原生临时文件协议
      url.indexOf('http://tmp/') === 0      // 真机上的临时文件协议
    );
  },

  // === 仅 UI：从昵称取首字母（无昵称时为 'U'） ===
  computeAvatarLetter(user) {
    if (!user) return 'U';
    const name = (user.nickname || user.nickName || '').trim();
    if (!name) return 'U';
    return name.charAt(0).toUpperCase();
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
      const config = require('../../config');

      console.log('=== 开始微信登录流程 ===');
      const loginRes = await wx.login();
      console.log('wx.login 结果:', loginRes);

      if (!loginRes.code) {
        throw new Error('获取登录code失败: ' + loginRes.errMsg);
      }

      // === Step 1: 微信登录拿 token（先不带头像，避免临时 URL 入库） ===
      const loginData = await request({
        url: '/auth/wechat-login',
        method: 'POST',
        data: {
          code: loginRes.code,
          nickname: nickname,
          avatar_url: '' // 临时 URL 不入库，下一步上传后再回填
        },
        noLoading: true
      });
      console.log('微信登录成功', loginData);

      // === Step 2: 上传微信临时头像，换永久 URL（best-effort，失败不阻塞登录） ===
      let permanentAvatarUrl = '';
      if (avatarUrl) {
        try {
          permanentAvatarUrl = await this.uploadAvatar(avatarUrl, loginData.token);
          console.log('头像上传成功:', permanentAvatarUrl);
        } catch (uploadErr) {
          console.warn('头像上传失败，使用昵称首字母占位', uploadErr);
        }
      }

      // === Step 3: 把永久 URL 写回数据库（拿到才调，避免空写） ===
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

  // 把微信临时头像 URL（http://127.0.0.1/__tmp__ 或 wxfile://）上传到后端，返回永久绝对 URL
  uploadAvatar(tempFilePath, token) {
    const config = require('../../config');
    return new Promise((resolve, reject) => {
      wx.uploadFile({
        url: `${config.baseURL}/upload/image`,
        filePath: tempFilePath,
        name: 'file',
        header: {
          Authorization: `Bearer ${token}`
        },
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
          // 后端返回 /uploads/xxx.jpg，拼成绝对 URL 才能在小程序 Image 渲染
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
    // 触发预拉取，让 orders-sheet 一打开就有数据
    const ordersPrefetch = require('../../utils/orders-prefetch');
    ordersPrefetch.prefetchFirstPage(20);

    // 隐藏自定义 TabBar，让弹窗能真正全屏覆盖
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tabBar && tabBar.setHidden) {
      tabBar.setHidden(true);
    }

    this.setData({ showOrdersSheet: true });
  },

  onOrdersSheetClose() {
    this.setData({ showOrdersSheet: false });
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tabBar && tabBar.setHidden) {
      tabBar.setHidden(false);
    }
  }
})
