// utils/dishes-cache.js
// dishes 数据持久化缓存：内存 + storage 双层，30 分钟内不再请求
const { request } = require('./request');

const STORAGE_KEY = 'dishes_cache_v1';
const TTL_MS = 30 * 60 * 1000; // 30 分钟

let memCache = null; // { data, savedAt }

function read() {
  if (memCache) return memCache;
  try {
    const raw = wx.getStorageSync(STORAGE_KEY);
    if (raw && raw.data && Array.isArray(raw.data)) {
      memCache = raw;
      return raw;
    }
  } catch (e) {
    /* noop */
  }
  return null;
}

function write(data) {
  const entry = { data, savedAt: Date.now() };
  memCache = entry;
  try {
    wx.setStorageSync(STORAGE_KEY, entry);
  } catch (e) {
    /* noop */
  }
}

/**
 * 获取菜品列表
 * @param {boolean} forceRefresh 强制重拉（用于下拉刷新或菜品管理变更后）
 * @returns {Promise<Array>}
 */
async function getDishes(forceRefresh = false) {
  if (!forceRefresh) {
    const cached = read();
    if (cached && Date.now() - cached.savedAt < TTL_MS) {
      return cached.data;
    }
  }
  const data = await request({ url: '/dishes', noLoading: true });
  if (Array.isArray(data) && data.length > 0) {
    write(data);
    // 同步全局，便于其它老代码读取
    const app = getApp();
    if (app && app.globalData) {
      app.globalData.allDishes = data;
    }
  }
  return Array.isArray(data) ? data : [];
}

/** 后台静默更新（不阻塞 UI） */
function refreshInBackground() {
  getDishes(true).catch(() => { /* noop */ });
}

function clear() {
  memCache = null;
  try {
    wx.removeStorageSync(STORAGE_KEY);
  } catch (e) {
    /* noop */
  }
}

module.exports = { getDishes, refreshInBackground, clear };
