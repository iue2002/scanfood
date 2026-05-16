const config = require('../config');

const request = (options) => {
  return new Promise((resolve, reject) => {
    const token = wx.getStorageSync('token');
    
    if (!options.noLoading) {
      wx.showLoading({ title: '加载中...', mask: true });
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
        if (!options.noLoading) {
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
