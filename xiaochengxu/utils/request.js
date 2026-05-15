const config = require('../config');

const request = (options) => {
  return new Promise((resolve, reject) => {
    const token = wx.getStorageSync('token');
    
    if (!options.noLoading) {
      wx.showLoading({ title: '加载中...', mask: true });
    }

    const requestUrl = options.url.startsWith('http') ? options.url : config.baseURL + options.url;

    wx.request({
      url: requestUrl,
      method: options.method || 'GET',
      data: options.data,
      timeout: 10000, // 设置 10 秒超时
      header: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : '',
        ...options.header
      },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else if (res.statusCode === 401) {
          wx.removeStorageSync('token');
          reject(res);
        } else {
          reject(res);
        }
      },
      fail: (err) => {
        console.error('Request Fail:', err);
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
