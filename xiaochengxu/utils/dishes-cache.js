// utils/dishes-cache.js
// dishes 数据持久化缓存：内存 + storage 双层，stale-while-revalidate 策略
//
// 设计原则（业界主流做法，等同 SWR / React Query）：
//   1. 缓存命中 → 立即返回，UI 秒出
//   2. 同时后台 fetch 最新版本（节流：30 秒内最多 1 次）
//   3. 后台数据有变化 → 广播给所有订阅者（页面/组件）
//   4. 订阅者自动 setData 拿到新 image_url，菜品列表实时更新
//
// 这样商家改了菜品图，顾客下次打开秒看到旧图（不卡白屏）+ 1 秒后自动换成新图
const { request } = require('./request');

const STORAGE_KEY = 'dishes_cache_v1';
const SOFT_TTL_MS = 30 * 1000;          // 30 秒：超过则后台刷新（缓存仍可用）
const HARD_TTL_MS = 30 * 60 * 1000;     // 30 分钟：硬过期，必须等待新数据

let memCache = null; // { data, savedAt }
let inflight = null; // 并发去重：同时只有一个网络请求
let lastBackgroundFetchAt = 0;
const subscribers = new Set();

function read() {
  if (memCache) return memCache;
  try {
    const raw = wx.getStorageSync(STORAGE_KEY);
    if (raw && raw.data && Array.isArray(raw.data)) {
      memCache = raw;
      return raw;
    }
  } catch (e) { /* noop */ }
  return null;
}

function write(data) {
  const entry = { data, savedAt: Date.now() };
  memCache = entry;
  try {
    wx.setStorageSync(STORAGE_KEY, entry);
  } catch (e) { /* noop */ }
}

/** 浅比较菜品列表是否变化（仅看 id+image_url+price+status，足够触发 UI 更新） */
function hasChanged(oldList, newList) {
  if (!Array.isArray(oldList) || !Array.isArray(newList)) return true;
  if (oldList.length !== newList.length) return true;
  const map = new Map(oldList.map(d => [d.id, d]));
  for (const n of newList) {
    const o = map.get(n.id);
    if (!o) return true;
    if (
      o.image_url !== n.image_url ||
      o.price !== n.price ||
      o.status !== n.status ||
      o.name !== n.name ||
      o.description !== n.description
    ) return true;
  }
  return false;
}

function notify(data) {
  for (const fn of subscribers) {
    try { fn(data); } catch (e) { /* ignore */ }
  }
}

async function fetchFromServer() {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const data = await request({ url: '/dishes', noLoading: true });
      if (Array.isArray(data) && data.length > 0) {
        const old = memCache?.data;
        write(data);
        const app = getApp();
        if (app && app.globalData) {
          app.globalData.allDishes = data;
        }
        // 数据有变化 → 通知订阅者
        if (hasChanged(old, data)) {
          notify(data);
        }
        return data;
      }
      return Array.isArray(data) ? data : [];
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * 获取菜品列表（stale-while-revalidate）
 * @param {boolean} forceRefresh 强制重拉（用于下拉刷新）
 */
async function getDishes(forceRefresh = false) {
  const now = Date.now();
  const cached = read();

  // 1. 强制刷新：必须拿新数据
  if (forceRefresh) {
    return fetchFromServer().catch(() => cached?.data || []);
  }

  // 2. 没有缓存 / 缓存硬过期：必须等新数据
  if (!cached || now - cached.savedAt > HARD_TTL_MS) {
    return fetchFromServer().catch(() => cached?.data || []);
  }

  // 3. 缓存软过期（>30s 但 <30min）：返回缓存 + 后台刷新
  if (now - cached.savedAt > SOFT_TTL_MS) {
    if (now - lastBackgroundFetchAt > SOFT_TTL_MS) {
      lastBackgroundFetchAt = now;
      fetchFromServer().catch(() => { /* 后台失败不影响 UI */ });
    }
    return cached.data;
  }

  // 4. 缓存新鲜：直接返回
  return cached.data;
}

/** 后台静默更新（不阻塞 UI） */
function refreshInBackground() {
  fetchFromServer().catch(() => { /* noop */ });
}

/**
 * 订阅菜品变化（页面/组件用）
 * @param {Function} fn (newDishesList) => void
 * @returns 解订阅函数
 */
function subscribe(fn) {
  if (typeof fn !== 'function') return () => {};
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function clear() {
  memCache = null;
  inflight = null;
  lastBackgroundFetchAt = 0;
  try {
    wx.removeStorageSync(STORAGE_KEY);
  } catch (e) { /* noop */ }
}

module.exports = { getDishes, refreshInBackground, subscribe, clear };
