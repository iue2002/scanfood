// utils/orders-prefetch.js
// 订单列表预拉取：在用户点击"我的订单"那一刻就开始 fetch，
// 等 list 页 onLoad 时数据已经在内存里，立即渲染（秒开）。
const { request } = require('./request');
const dishesCache = require('./dishes-cache');

let pending = null; // { ordersPromise, dishesPromise, startedAt }

const TTL_MS = 5000; // 5 秒内 list 页能拿到这份预拉取结果，超时丢弃

function prefetchFirstPage(pageSize = 20) {
  pending = {
    startedAt: Date.now(),
    ordersPromise: request({
      url: `/orders/my-orders?page=1&page_size=${pageSize}`,
      noLoading: true
    }).catch(() => null),
    dishesPromise: dishesCache.getDishes().catch(() => null)
  };
}

/**
 * 取走（消费）一次预拉取结果。返回 { orders, dishes } 或 null。
 * 取走后清空，避免下次脏读。
 */
async function consume() {
  if (!pending) return null;
  if (Date.now() - pending.startedAt > TTL_MS) {
    pending = null;
    return null;
  }
  const { ordersPromise, dishesPromise } = pending;
  pending = null;
  const [ordersResult, dishes] = await Promise.all([ordersPromise, dishesPromise]);
  return { ordersResult, dishes };
}

function clear() {
  pending = null;
}

module.exports = { prefetchFirstPage, consume, clear };
