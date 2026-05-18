/**
 * 小程序全局配置文件
 * 所有的后端服务地址及跨服务器通讯配置均在此统一管理
 */

// 环境配置
const ENV = {
  // 本地开发环境（仅限微信开发者工具，需勾选「不校验合法域名」）
  LOCAL: {
    SERVER_URL: 'http://localhost:3000',
    desc: '本地开发环境'
  },
  // 内网穿透环境（开发版/体验版测试用，使用 cpolar/natapp 等工具）
  TUNNEL: {
    SERVER_URL: 'https://4f7050c.r9.cpolar.cn',
    desc: '内网穿透环境'
  },
  // 生产环境
  PROD: {
    SERVER_URL: 'https://api.your-domain.com',
    desc: '生产环境'
  }
};

// 当前使用的环境
// 切换说明：
// - 开发者工具本地调试：使用 'LOCAL'
// - 真机开发版/体验版测试：使用 'TUNNEL'（需要先配置内网穿透）
// - 正式发布：使用 'PROD'
const CURRENT_ENV = 'TUNNEL';

const config = {
  // 当前环境信息
  currentEnv: CURRENT_ENV,
  envDesc: ENV[CURRENT_ENV].desc,
  
  // 后端服务器地址
  SERVER_URL: ENV[CURRENT_ENV].SERVER_URL,
  
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
