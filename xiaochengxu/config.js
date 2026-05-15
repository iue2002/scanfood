/**
 * 小程序全局配置文件
 * 所有的后端服务地址及跨服务器通讯配置均在此统一管理
 */

const config = {
  // 后端服务器地址 (跨服务器通讯时只需修改此处)
  // 开发环境通常为 http://localhost:3000
  // 生产环境应修改为远程服务器地址，例如 https://api.your-domain.com
  SERVER_URL: 'http://localhost:3000',
  
  // API 基础路径
  API_PREFIX: '/api',
  
  // 组合后的完整 API 地址
  get baseURL() {
    return `${this.SERVER_URL}${this.API_PREFIX}`;
  },

  // 其他配置项
  VERSION: '1.0.0',
};

module.exports = config;
