// components/me-sheet/index.js
// "我的"全屏弹窗组件：业务逻辑与 pages/me/me.js 完全一致
// 用作组件后，从浏览页 setData 即可打开，避免 wx.switchTab 的 webview 创建延迟
const { request } = require('../../utils/request');

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
      observer(newVal) {
        if (newVal) {
          this.handleOpen();
        }
      }
    }
  },

  data: {
    userInfo: null,
    isLoading: false,
    showAuthModal: false,
    showNicknameModal: false,
    tempAvatarUrl: '',
    tempNickname: '',
    avatarError: false,
    avatarLetter: 'U',
    statusBarHeight: 0,
    // 入场动画 class
    sheetIn: false,
    // 内部 sheet：订单列表（保持 me 页原有"点我的订单"行为）
    showOrdersSheet: false
  },

  lifetimes: {
    attached() {
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
      // 触发入场动画
      this.setData({ sheetIn: false });
      wx.nextTick(() => {
        this.setData({ sheetIn: true });
      });
      // 加载用户信息（与原 me 页 onShow 一致）
      this.loadUserInfo();
    },

    // 父级幂等调用：sheet 已经显示时强制重置动画 + 重载用户信息
    // 防止小程序待机后状态残留导致点"我的"无反应
    reopen() {
      this.handleOpen();
    },

    onClose() {
      this.setData({ sheetIn: false });
      // 等动画结束再触发关闭事件（与 CSS transition 220ms 对齐）
      setTimeout(() => {
        this.triggerEvent('close');
      }, 220);
    },

    // ====== 以下方法逐字迁移自 pages/me/me.js（业务逻辑零修改） ======

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

        console.log('=== 开始微信登录流程 ===');
        const loginRes = await wx.login();
        console.log('wx.login 结果:', loginRes);

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
        console.log('微信登录成功', loginData);

        let permanentAvatarUrl = '';
        if (avatarUrl) {
          try {
            permanentAvatarUrl = await this.uploadAvatar(avatarUrl, loginData.token);
            console.log('头像上传成功:', permanentAvatarUrl);
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
        wx.showToast({
          title: '登录失败，请重试',
          icon: 'none'
        });
      }
    },

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
      const ordersPrefetch = require('../../utils/orders-prefetch');
      ordersPrefetch.prefetchFirstPage(20);
      // 在 me-sheet 内部叠开 orders-sheet（栈式：me 之上叠订单）
      this.setData({ showOrdersSheet: true });
    },

    onOrdersSheetClose() {
      this.setData({ showOrdersSheet: false });
    },

    // 订单列表中"再来一单"完成 → 通知父级（order 页）打开 confirm-sheet
    onOrdersReorder(e) {
      const tableId = e.detail && e.detail.tableId;
      // me-sheet 也关掉，避免遮挡 confirm-sheet
      this.setData({ showOrdersSheet: false, sheetIn: false });
      setTimeout(() => {
        this.triggerEvent('close');
        this.triggerEvent('reorder', { tableId });
      }, 220);
    },

    // 订单列表中"查看详情" → 透传给 order 页打开 detail-sheet
    // orders-sheet 不关闭：detail-sheet z-index 更高，会叠在订单列表上方；
    // detail-sheet 关闭后，下层 orders-sheet 自动显露（保留原有滚动位置 + tab 状态），
    // 实现 iOS 原生 modal stack 般的"返回上一级"体验
    onOrdersDetail(e) {
      const orderId = e.detail && e.detail.orderId;
      this.triggerEvent('detail', { orderId });
    }
  }
});
