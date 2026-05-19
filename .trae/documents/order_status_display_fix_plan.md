# 订单状态显示不一致 Bug 修复方案

## 一、问题描述

用户发现：在小程序选餐阶段，后台管理系统就已经显示了"已提交"订单。但实际上用户并没有点击"提交订单"按钮。

### 复现步骤

1. 用户在小程序扫码绑定桌台
2. 用户选菜（`order.js` 中 `updateCart` → `syncCartToBackend()` 调用）
3. **后端立即创建 `draft` 状态订单**（为了 WebSocket 实时同步多人点餐）
4. 商家管理后台显示该订单，**状态显示为"已提交"** 
5. 小程序端显示该订单状态为"待提交" ✅

### 核心矛盾

| 端 | 数据库状态 | 显示文本 | 正确性 |
|---|---|---|---|
| 小程序 detail.js | `draft` | `待提交` | ✅ 正确 |
| 管理后台 OrderManage.tsx | `draft` | `已提交` | ❌ 错误 |

## 二、根因分析

### 2.1 数据流梳理

```
用户选菜 (order.js)
  ↓
updateCart() → syncCartToBackend()
  ↓
POST /api/orders/sync-draft  (后端创建 draft 订单)
  ↓
后端 WebSocket 广播 → 管理后台收到 orderUpdated
  ↓
管理后台 GET /api/orders (查询所有订单，无状态过滤)
  ↓
返回包含 draft 状态的订单
  ↓
管理后台 statusMap 无 draft 映射 → 使用 fallback: statusMap.submitted = "已提交" ❌
```

### 2.2 后端接口分析

**`getTableCurrentOrder(tableId)`** — 查询范围包含 `['draft', 'submitted', 'printed']`
- 用于小程序端获取当前桌台的活跃订单
- **设计合理**：需要返回 draft 以便多人点餐同步

**`getOrders()`** — 管理后台订单列表，默认无状态过滤
- 返回数据库中**所有状态**的订单（包括 draft）
- **设计问题**：管理后台不应该看到 draft 草稿订单

### 2.3 前端状态映射分析

**管理后台 `statusMap`**（[OrderManage.tsx](file:///d:/alay-balay/scanfood/project_20260514_191238/projects/admin-web/src/pages/OrderManage.tsx#L48-L54)）：
```typescript
const statusMap: Record<string, { label: string; color: string }> = {
  submitted: { label: '已提交', color: '...' },
  printed: { label: '已打印', color: '...' },
  settled: { label: '已结账', color: '...' },
  cancelled: { label: '已取消', color: '...' },
  refunded: { label: '已退款', color: '...' },
  // ❌ 缺少 draft 映射
}

// 使用时 fallback 到 submitted
const s = statusMap[order.status] || statusMap.submitted  // draft → "已提交" ❌
```

**小程序 `statusMap`**（[detail.js](file:///d:/alay-balay/scanfood/project_20260514_191238/projects/xiaochengxu/pages/order/detail.js#L8-L15)）：
```javascript
statusMap: {
  'draft': '待提交',      // ✅ 正确
  'submitted': '已提交',
  'printed': '已下单',
  'settled': '已结账',
  'cancelled': '已取消',
  'refunded': '已退款'
}
```

### 2.4 为什么不能简单删除 draft 订单

- **WebSocket 实时同步需求**：用户选菜时需要通过后端 draft 订单让同桌其他人实时看到菜品
- **多人点餐**：A 选了羊肉串，B 的页面要立即显示，这依赖后端的 draft 数据
- **`syncCartToBackend()` 是核心机制**：每次选菜都会调用，不能移除

## 三、修复方案

### 方案：管理后台过滤 draft 订单 + 补全状态映射

**核心思路**：管理后台只展示**真实订单**（用户明确点击"提交订单"后的订单），不展示草稿。同时补全状态映射，确保所有状态都有正确的显示文本。

### 修改清单

#### 修改 1: [OrderManage.tsx](file:///d:/alay-balay/scanfood/project_20260514_191238/projects/admin-web/src/pages/OrderManage.tsx) — 管理后台

**1.1 补全 `statusMap`，添加 `draft` 映射**

在 `statusMap` 中添加 `draft` 条目：

```typescript
const statusMap: Record<string, { label: string; color: string }> = {
  draft: { label: '待提交', color: 'text-[#94A3B8] bg-[#F1F5F9]' },
  submitted: { label: '已提交', color: 'text-[#F59E0B] bg-[#FEF3C7]' },
  printed: { label: '已打印', color: 'text-[#2563EB] bg-[#EFF6FF]' },
  settled: { label: '已结账', color: 'text-[#10B981] bg-[#D1FAE5]' },
  cancelled: { label: '已取消', color: 'text-[#EF4444] bg-red-50' },
  refunded: { label: '已退款', color: 'text-[#94A3B8] bg-[#F1F5F9]' },
}
```

**1.2 修改筛选选项，添加"待提交"选项**

在状态筛选下拉框中添加 `draft` 选项：

```tsx
<select value={filterStatus} onChange={...}>
  <option value="">全部状态</option>
  <option value="draft">待提交</option>     {/* 新增 */}
  <option value="submitted">已提交</option>
  <option value="printed">已打印</option>
  <option value="settled">已结账</option>
  <option value="cancelled">已取消</option>
  <option value="refunded">已退款</option>
</select>
```

**1.3 修改默认查询：排除 draft 订单**

修改 `fetchOrders` 函数，默认过滤掉 draft 订单（商家只看真实订单）：

```typescript
const fetchOrders = useCallback(() => {
  const params: any = {
    page: currentPage,
    page_size: pageSize
  }
  // 默认排除 draft，只显示真实订单
  if (!filterStatus) {
    params.exclude_draft = 'true'
  } else if (filterStatus) {
    params.status = filterStatus
  }
  // ... 其余不变
}, [...])
```

**1.4 修改操作按钮逻辑：draft 订单不显示结账/取消按钮**

对于 `draft` 状态的订单，不显示"结账"和"取消"按钮（因为它们不是真实订单）。

#### 修改 2: [orders.controller.ts](file:///d:/alay-balay/scanfood/project_20260514_191238/projects/server/src/modules/orders/orders.controller.ts) — 后端接口

**2.1 修改 `getOrders` 接口，支持 `exclude_draft` 参数**

在管理后台订单列表查询时，默认排除 draft 订单：

```typescript
@Get()
async getOrders(
  @Query('status') status?: string,
  @Query('exclude_draft') excludeDraft?: string,  // 新增参数
  ...
) {
  // 如果未指定状态且要求排除 draft
  const skipDraft = !status && excludeDraft === 'true'
  const data = await this.ordersService.getOrders(status, tableIdNum, dateFrom, dateTo, tag, pageNum, size, skipDraft)
  ...
}
```

#### 修改 3: [orders.service.ts](file:///d:/alay-balay/scanfood/project_20260514_191238/projects/server/src/modules/orders/orders.service.ts) — 后端服务

**3.1 修改 `getOrders` 方法，支持跳过 draft**

```typescript
async getOrders(..., skipDraft = false) {
  const conditions: any[] = []
  if (skipDraft) {
    // 排除 draft 状态
    conditions.push(sql`${orders.status} != 'draft'`)
  }
  if (status) conditions.push(eq(orders.status, status))
  // ... 其余不变
}
```

### 修改后效果

| 场景 | 修改前 | 修改后 |
|------|--------|--------|
| 用户选菜中（draft） | 管理后台显示"已提交" ❌ | 管理后台不显示（默认过滤）✅ |
| 用户点击提交后（submitted） | 管理后台显示"已提交" | 管理后台显示"已提交" ✅ |
| 商家筛选"待提交" | 不支持 | 可筛选查看 draft 订单 ✅ |
| 操作按钮 | draft 订单也可结账/取消 ❌ | draft 订单不显示操作按钮 ✅ |

## 四、修改后完整状态流转

```
用户选菜
  ↓
syncCartToBackend() → POST /orders/sync-draft → 创建 draft 订单
  ↓
管理后台：默认不显示 draft（已过滤）
小程序：detail 页显示"待提交"
  ↓
用户点击"提交订单" → POST /orders/{id}/status {status: 'submitted'}
  ↓
状态变为 submitted
  ↓
管理后台：显示"已提交"，可结账/取消 ✅
小程序：detail 页显示"已提交"，可加餐
  ↓
商家操作：结账 → settled / 取消 → cancelled
```

## 五、关键设计决策

| 决策 | 说明 |
|------|------|
| **管理后台默认过滤 draft** | 商家只需要看到真实订单，draft 是临时状态，不应混淆 |
| **保留 draft 筛选选项** | 如果商家需要排查问题，可以手动筛选查看 draft 订单 |
| **补全 statusMap** | 即使有过滤，也要确保所有状态有正确映射，避免 fallback 到错误文本 |
| **draft 订单无操作按钮** | 草稿不是真实订单，不应允许商家结账或取消 |
| **不修改小程序端逻辑** | 小程序端的 draft 机制是核心功能，必须保留 |

## 六、测试用例

| # | 场景 | 预期结果 |
|---|------|----------|
| 1 | 用户选菜，未提交 | 管理后台订单列表不显示该订单 |
| 2 | 用户选菜后提交 | 管理后台显示"已提交"，可结账/取消 |
| 3 | 商家筛选"待提交" | 可看到 draft 状态的订单 |
| 4 | 用户加餐 | 管理后台已提交订单更新菜品，状态不变 |
| 5 | 商家结账 | 状态变为"已结账"，小程序端释放桌号 |
