# 订单误提交 Bug 修复方案

## 一、Bug 复现步骤（用户提供）

1. **扫码** → 绑定桌台
2. **选品** → 在 order.js 页面选择菜品，点击底部购物车图标进入 cart.js
3. **进入确认页面** → 在 cart.js 点击"下单"按钮，进入 confirm.js 确认订单页面，**但不点击"提交订单"**
4. **返回上一级** → 使用微信小程序返回按钮，从 confirm.js 返回 cart.js，再从 cart.js 返回 order.js

**结果**：用户未明确点击"提交订单"，但系统产生了异常状态（后端遗留草稿订单、前端状态不一致），导致商家无法结账、用户无法加餐。

---

## 二、核心根因分析

### 2.1 当前数据流

```
order.js (点菜)
  ↓ 更新 cartCount + syncCartToBackend() → 创建/更新后端 draft 订单
  ↓ 通过 WebSocket 通知其他设备
cart.js (购物车)
  ↓ goToConfirm() → navigateTo 到 confirm.js（未 await syncCartToBackend）
confirm.js (确认订单)
  ↓ onLoad() → fetchCurrentOrder() 从后端 GET /orders/current/{tableId}
  ↓ 显示 order.order_items 给用户
  ↓ 用户不点击"提交订单"，返回上一级
  ↓ 无任何清理逻辑！后端草稿订单残留 ❌
cart.js onShow()
  ↓ setData({ cartCount: {} }) ← 清空本地购物车状态
  ↓ fetchCurrentOrder() ← 从后端拉取残留的草稿订单覆盖回来
order.js onShow()
  ↓ setData({ cartCount: {}, currentOrderId: null, orderStatus: null }) ← 清空本地
  ↓ fetchCurrentOrder() ← 从后端拉取残留草稿
  ↓ 本地状态被后端脏数据覆盖 ❌
```

### 2.2 三个关键问题

| 问题 | 位置 | 描述 |
|------|------|------|
| **P1** | `confirm.js` | `fetchCurrentOrder()` 从后端拉取草稿订单，但用户放弃下单后无任何清理，后端遗留脏数据 |
| **P2** | `cart.js goToConfirm()` | 跳转到确认页面前**未等待** `syncCartToBackend()` 完成，后端数据可能与本地不一致 |
| **P3** | `order.js onShow()` | 先清空本地 `cartCount: {}`，再从后端 fetch，导致本地正确状态被后端脏数据覆盖 |

### 2.3 为什么不能只依赖本地缓存

用户明确要求："不可以只更新本地缓存的，我们有 WebSocket 实时更新购物车和其他伙伴实现同时点餐功能。"

这意味着：
- 多人同桌点餐时，A 加的菜必须通过后端 → WebSocket 实时同步给 B
- 不能只在本地 `globalData.carts` 里存数据，必须保持后端数据与本地数据的一致性
- 修复方案必须**保留现有的 `syncCartToBackend` 和 WebSocket 同步机制**

---

## 三、修复方案设计

### 设计原则

1. **confirm 页面**：从本地购物车数据构建订单预览（不依赖后端），离开时清理后端草稿
2. **cart 页面**：跳转 confirm 前确保后端已同步
3. **order 页面**：onShow 优先从本地恢复，本地无数据时才从后端 fetch
4. **全局**：保留 WebSocket 同步能力，确保多人点餐实时一致

### 修改文件清单

| 文件 | 修改内容 |
|------|----------|
| `xiaochengxu/pages/order/confirm.js` | 改用本地购物车构建预览 + 添加 onUnload 清理 |
| `xiaochengxu/pages/order/cart.js` | `goToConfirm()` 前 await syncCartToBackend |
| `xiaochengxu/pages/order/order.js` | `onShow()` 优先恢复本地状态 |

---

## 四、具体修改步骤

### Step 1: 修改 `confirm.js` — 从本地购物车构建订单预览

**目标**：不依赖后端的 draft 订单，直接从 `globalData.carts` 读取用户选择的菜品构建预览。

#### 1.1 修改 `data` 结构

```javascript
data: {
  tableId: '',
  order: null,       // 保留，用于本地构建的订单对象
  previewItems: [],  // 新增：从本地购物车构建的菜品列表
  totalCount: 0,     // 新增：总件数
  totalPrice: '0.00',// 新增：总价
  peopleRange: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  peopleIndex: 0,
  remark: ''
}
```

#### 1.2 修改 `onLoad` — 用本地数据替代 fetchCurrentOrder

```javascript
onLoad(options) {
  this.setData({ tableId: options.tableId });
  this.buildOrderFromLocalCart(); // 替换 fetchCurrentOrder()
}
```

#### 1.3 新增 `buildOrderFromLocalCart` 方法

从 `globalData.carts` 读取本地购物车，构建预览数据：

```javascript
buildOrderFromLocalCart() {
  const app = getApp();
  const cart = app.getCart(this.data.tableId);
  const cartCount = cart.cartCount || {};
  const allDishes = app.globalData.allDishes || [];
  const items = [];
  let totalCount = 0;
  let totalPrice = 0;

  for (const id in cartCount) {
    const count = cartCount[id];
    if (count > 0) {
      const dish = allDishes.find(d => d.id == id);
      if (dish) {
        const subtotal = (count * parseFloat(dish.price)).toFixed(2);
        items.push({
          id: dish.id,
          dish_name: dish.name,
          price: parseFloat(dish.price).toFixed(2),
          quantity: count,
          subtotal: subtotal,
          image_url: dish.image_url || ''
        });
        totalCount += count;
        totalPrice += count * parseFloat(dish.price);
      }
    }
  }

  // 构建一个模拟 order 对象，兼容现有 WXML 模板
  const order = {
    id: cart.currentOrderId,
    order_items: items,
    total_amount: totalPrice.toFixed(2)
  };

  this.setData({
    previewItems: items,
    totalCount,
    totalPrice: totalPrice.toFixed(2),
    order
  });
}
```

#### 1.4 新增 `onUnload` — 放弃下单时清理后端草稿

用户从 confirm 页面返回（未提交订单）时，需要清理后端遗留的草稿订单：

```javascript
onUnload() {
  // 用户未提交订单就返回，清理后端草稿
  if (this.data.order && this.data.order.id) {
    const { request } = require('../../utils/request');
    const config = require('../../config');
    
    // 静默删除后端草稿订单
    wx.request({
      url: `${config.baseURL}/orders/${this.data.order.id}`,
      method: 'DELETE',
      header: {
        'Authorization': `Bearer ${wx.getStorageSync('token')}`
      },
      timeout: 5000
    });
  }
}
```

#### 1.5 修改 `submitOrder` — 提交后不删除（已转为正式订单）

提交订单成功后，后端状态变为 `submitted`，不需要删除：

```javascript
async submitOrder() {
  // 检查是否有菜品
  if (!this.data.previewItems || this.data.previewItems.length === 0) {
    wx.showToast({ title: '请选择菜品', icon: 'none' });
    return;
  }

  try {
    // 先同步购物车到后端（确保草稿存在）
    const app = getApp();
    const cart = app.getCart(this.data.tableId);
    const cartCount = cart.cartCount || {};
    const allDishes = app.globalData.allDishes || [];
    const items = [];
    const userInfo = app.globalData.userInfo;
    
    for (const id in cartCount) {
      const count = cartCount[id];
      if (count > 0) {
        const dish = allDishes.find(d => d.id == id);
        if (dish) {
          items.push({
            dish_id: dish.id,
            dish_name: dish.name,
            price: parseFloat(dish.price),
            quantity: count,
            added_by_user_id: userInfo?.id,
            added_by_nickname: userInfo?.nickname || '未知用户'
          });
        }
      }
    }

    // 先确保后端有 draft 订单
    let orderId = this.data.order?.id;
    if (!orderId) {
      const result = await request({
        url: '/orders/sync-draft',
        method: 'POST',
        data: {
          table_id: parseInt(this.data.tableId),
          items: items,
          user_id: userInfo?.id
        },
        noLoading: true
      });
      orderId = result.id;
    }

    // 提交订单（更新状态为 submitted）
    const result = await request({
      url: `/orders/${orderId}/status`,
      method: 'POST',
      data: {
        status: 'submitted',
        remark: this.data.remark,
      }
    });
    
    // 清理本地购物车
    app.clearCart(this.data.tableId);
    
    wx.showToast({ title: '下单成功' });
    wx.redirectTo({
      url: `/pages/order/detail?id=${orderId}`,
    });
  } catch (err) {
    console.error('提交订单失败', err);
  }
}
```

#### 1.6 修改 `confirm.wxml`

确保模板兼容本地构建的 previewItems 和 order 对象（当前模板使用 `order.order_items` 和 `order.total_amount`，与 buildOrderFromLocalCart 构建的结构一致，**无需修改**）。

---

### Step 2: 修改 `cart.js` — 跳转 confirm 前确保后端同步

#### 2.1 修改 `goToConfirm` 方法

```javascript
async goToConfirm() {
  if (this.data.isAddMore) {
    wx.showModal({
      title: '确认提交加餐',
      content: `共${this.data.totalCount}件菜品，合计¥${this.data.totalPrice}，确认提交？`,
      success: (res) => {
        if (res.confirm) {
          this.submitAddMore();
        }
      }
    });
  } else {
    // 跳转前确保后端已同步
    await this.syncCartToBackend();
    wx.navigateTo({
      url: `/pages/order/confirm?tableId=${this.data.tableId}`,
    });
  }
}
```

**目的**：确保用户从 cart 进入 confirm 时，后端草稿订单已包含最新的菜品数据。这样即使 confirm 页面需要 fallback 到后端数据，也能获取到正确的内容。

---

### Step 3: 修改 `order.js` — onShow 优先恢复本地状态

#### 3.1 修改 `onShow` 方法

当前逻辑（问题）：
```javascript
// ❌ 问题：先清空本地，再从后端 fetch → 被后端脏数据覆盖
this.setData({ cartCount: {}, currentOrderId: null, orderStatus: null, ... });
this.fetchCurrentOrder();
```

修改后：
```javascript
async onShow() {
  // 先处理页面状态
  if (getApp().globalData.addMore) {
    getApp().globalData.addMore = false;
    this.setData({ isAddMore: true });
  }

  if (this.data.tableId && !this.data.isAddMore) {
    // ✅ 优先从本地购物车恢复状态
    const cart = getApp().getCart(this.data.tableId);
    const cartCount = cart.cartCount || {};
    const hasLocalData = Object.values(cartCount).some(count => count > 0);

    if (hasLocalData) {
      // 本地有数据，直接恢复（不覆盖）
      this.setData({
        cartCount: { ...cartCount },
        currentOrderId: cart.currentOrderId || null,
        orderStatus: cart.orderStatus || null
      });
      this.calculateTotal();
    } else {
      // 本地无数据，才从后端 fetch（可能是其他用户加的菜）
      this.setData({ cartCount: {}, currentOrderId: null, orderStatus: null, totalCount: 0, totalPrice: '0.00' });
      this.fetchCurrentOrder();
    }
  } else if (this.data.tableId && this.data.isAddMore) {
    // 加餐模式保持原有逻辑
    const addMoreCart = getApp().getAddMoreCart(this.data.tableId);
    if (!addMoreCart.currentOrderId) {
      this.fetchCurrentOrderForAddMore();
    } else {
      this.setData({
        cartCount: { ...addMoreCart.cartCount },
        currentOrderId: addMoreCart.currentOrderId,
        orderStatus: addMoreCart.orderStatus
      });
      this.calculateTotal();
    }
  }
  this.updateTabBar();
  this.checkActiveOrderAsync();
}
```

**目的**：
- 如果本地 `globalData.carts` 有数据（用户刚选过菜），直接恢复，**不从后端覆盖**
- 如果本地无数据（首次进入或清空后），才从后端 fetch（获取其他用户同步的菜品）
- 这样避免了"用户放弃下单后，后端脏数据覆盖本地干净状态"的问题

---

## 五、修改后完整流程验证

### 场景 1：正常下单（用户点击提交）

```
order.js 选菜 → cart.js 查看 → goToConfirm() [await syncCartToBackend] 
→ confirm.js buildOrderFromLocalCart() 构建预览
→ 用户点击"提交订单" → submitOrder() 提交 → 清理本地购物车 → 跳转详情页
→ onUnload 触发时 order.id 存在但已转为 submitted，DELETE 会失败（安全，后端只允许删除 draft）
```

### 场景 2：放弃下单（用户返回）— **修复的核心场景**

```
order.js 选菜 → cart.js 查看 → goToConfirm() [await syncCartToBackend]
→ confirm.js buildOrderFromLocalCart() 构建预览
→ 用户点击返回 → onUnload() 触发 → DELETE /orders/{draftId} 清理后端草稿 ✅
→ 返回 cart.js → onShow() 优先从本地恢复（本地还有数据）
→ 返回 order.js → onShow() 优先从本地恢复 ✅
→ 后端无残留草稿，不会导致状态混乱 ✅
```

### 场景 3：多人同时点餐（WebSocket 同步）

```
用户 A：order.js 选菜 → syncCartToBackend() → 后端更新 draft → WebSocket 广播
用户 B：order.js 收到 WebSocket 消息 → handleOrderUpdate() → 更新 cartCount ✅
用户 A：进入 confirm.js → buildOrderFromLocalCart()（包含 A 选的菜）
用户 A：提交订单 → 状态变为 submitted → WebSocket 广播 → 用户 B 被 redirect 到详情页 ✅
```

### 场景 4：用户清空购物车后放弃下单

```
cart.js 清空 → syncCartToBackend() → 后端 DELETE draft → globalData.carts 清空
→ 进入 confirm.js → buildOrderFromLocalCart() → previewItems 为空
→ 用户看到空列表，可以返回或添加菜品
→ onUnload() 触发 → order.id 可能不存在（安全跳过 DELETE）✅
```

---

## 六、关键设计决策

| 决策 | 说明 |
|------|------|
| **confirm 页从本地读取而非后端** | 避免依赖可能被污染的 draft 订单，确保用户看到的是自己刚选的菜品 |
| **onUnload 删除后端草稿** | 用户放弃下单时，及时清理后端脏数据，不影响其他用户的点餐流程 |
| **DELETE 对 submitted 订单安全** | 后端 `deleteOrder` 方法只允许删除 `draft` 状态，已提交的订单 DELETE 会报错（被 catch 忽略） |
| **order.js onShow 优先本地** | 避免后端脏数据覆盖用户本地的正确状态 |
| **保留 WebSocket 同步** | 所有 syncCartToBackend 调用保持不变，多人点餐实时同步不受影响 |

---

## 七、测试用例

| # | 场景 | 预期结果 |
|---|------|----------|
| 1 | 选菜 → 进入确认 → 不提交 → 返回 → 再次进入确认 | 菜品列表正确，无状态混乱 |
| 2 | 选菜 → 进入确认 → 提交订单 → 跳转详情页 | 下单成功，状态为 submitted |
| 3 | 选菜 → 进入确认 → 不提交 → 返回 → 再选菜 → 提交 | 最终订单包含所有菜品 |
| 4 | 多人同时选菜 → WebSocket 同步 → 一人提交 | 所有菜品正确，订单金额正确 |
| 5 | 清空购物车 → 进入确认 → 返回 | 空列表，无报错 |
| 6 | 后端已有 draft 订单（其他用户） → 进入确认 | 显示自己的菜品（从 local cart 构建） |
