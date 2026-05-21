const config = require('../config');

/**
 * 网络请求封装
 *
 * 设计原则（重要）：
 * - 默认 **不显示** loading 蒙层。loading 蒙层 mask:true 会全屏冻结交互，
 *   80% 的接口（按钮提交除外）应该静默请求 + 局部 spinner / 骨架屏。
 * - 需要 loading 的场景显式传 loading: true（例如：用户提交订单的 submit 按钮）。
 *
 * 兼容旧代码：noLoading: true 仍然有效（含义不变：明确不显示）。
 */
const request = (options) => {
  return new Promise((resolve, reject) => {
    const token = wx.getStorageSync('token');

    // 默认不显示 loading；显式 loading:true 才显示
    const showLoading = options.loading === true && !options.noLoading;
    if (showLoading) {
      wx.showLoading({ title: options.loadingTitle || '加载中...', mask: true });
    }

    const requestUrl = options.url.startsWith('http') ? options.url : config.baseURL + options.url;

    const headers = {
      'Content-Type': 'application/json',
      ...options.header
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    wx.request({
      url: requestUrl,
      method: options.method || 'GET',
      data: options.data,
      timeout: 30000,
      header: headers,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else if (res.statusCode === 401) {
          wx.removeStorageSync('token');
          wx.showToast({
            title: '登录已过期，请重新登录',
            icon: 'none',
            duration: 2000
          });
          reject(res);
        } else if (res.statusCode === 404) {
          wx.showToast({
            title: '请求的资源不存在',
            icon: 'none',
            duration: 2000
          });
          reject(res);
        } else if (res.statusCode >= 500) {
          wx.showToast({
            title: '服务器错误，请稍后重试',
            icon: 'none',
            duration: 2000
          });
          reject(res);
        } else {
          reject(res);
        }
      },
      fail: (err) => {
        console.error('Request Fail:', err);
        wx.showToast({
          title: '网络连接失败，请检查网络设置',
          icon: 'none',
          duration: 2000
        });
        reject(err);
      },
      complete: () => {
        if (showLoading) {
          wx.hideLoading();
        }
      }
    });
  });
};

module.exports = {
  request,
  baseURL: config.baseURL,
  serverURL: config.SERVER_URL
};
