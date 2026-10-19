# 安全扫描与问题汇总报告

> 扫描时间：2026-06-03
> 扫描范围：server（后端）、xiaochengxu（小程序端）、admin-web（商家端）
> 扫描工具：TRAE-security-review + 人工代码审查

---

## 一、后端（server）问题

### 1.1 SQL 注入风险（HIGH）

**文件**：`server/src/modules/common/adapters/mysql-event-outbox.adapter.ts`

**问题**：直接拼接 `ids.join(',')` 到 SQL 语句中，若 `ids` 来源不可控则存在注入风险。

```ts
await db.update(eventOutbox).set({ status: 'processing' })
  .where(sql`${eventOutbox.id} IN (${ids.join(',')})` as any);
```

**建议**：使用 Drizzle 的参数化查询或 `inArray()` 辅助函数，禁止手动拼接 SQL。

---

### 1.2 SQL 注入风险（MEDIUM）

**文件**：`server/src/modules/merchant-ops/employee/employee-repo.drizzle.ts`

**问题**：`LIKE` 查询中直接拼接用户输入 `filter.username`。

```ts
if (filter.username) conditions.push(like(users.username, `%${filter.username}%`));
```

**建议**：对用户输入做转义过滤，或使用 Drizzle 的参数化方式。

---

### 1.3 用户名大小写敏感导致锁定绕过（MEDIUM）

**文件**：`server/src/modules/auth/auth.service.ts`

**问题**：锁定键 `login:lock:${username}` 未做大小写规范化，导致 `Admin` 和 `admin` 被视为不同用户。

**建议**：统一转为小写 `login:lock:${username.toLowerCase()}`。

---

### 1.4 验证码错误不计入失败次数（MEDIUM）

**文件**：`server/src/modules/auth/auth.service.ts`

**问题**：验证码错误时未调用 `recordFailedAttempt()`，攻击者可无限尝试验证码而不触发锁定。

**建议**：在验证码错误处理中添加 `await this.recordFailedAttempt(username);`。

---

### 1.5 N+1 查询性能问题（LOW）

**文件**：`server/src/modules/orders/orders.service.ts`

**问题**：循环内多次查询数据库。

```ts
const items = await db.select().from(order_items).where(eq(order_items.order_id, id));
const tableResult = await db.select().from(tables).where(eq(tables.id, order.table_id));
const userResult = order.user_id ? await db.select().from(users).where(eq(users.id, order.user_id)) : [];
```

**建议**：使用 JOIN 或批量查询（`IN`）一次性获取关联数据。

---

### 1.6 大偏移分页性能问题（LOW）

**文件**：`server/src/modules/orders/orders.service.ts`

**问题**：`LIMIT ? OFFSET ?` 在大页码时性能急剧下降。

**建议**：采用游标分页（cursor-based）或限制最大偏移量。

---

## 二、小程序端（xiaochengxu）问题

### 2.1 WebSocket Token 明文暴露（MEDIUM）

**文件**：`xiaochengxu/pages/order/order.js`、`xiaochengxu/pages/detail/detail.js`

**问题**：WebSocket 连接 URL 将 JWT token 作为 query 参数明文传输。

```js
const wsUrl = serverURL.replace('http', 'ws').replace('https', 'wss') + `/ws?token=${token}`;
```

**风险**：token 可能出现在服务器访问日志、代理历史记录中。

**建议**：改用 `header` 传递 token，或改用 `wss` + 短期 ticket 机制。

---

### 2.2 本地存储敏感信息未加密（MEDIUM）

**文件**：`xiaochengxu/app.js`、`xiaochengxu/utils/request.js`

**问题**：用户敏感信息（token、userInfo）存储在 `wx.setStorageSync`，无加密。

```js
wx.setStorageSync('token', loginData.token);
wx.setStorageSync('userInfo', finalUser);
```

**建议**：敏感数据使用微信 `UserCryptoManager` 或至少做简单加密；token 设置合理过期时间。

---

### 2.3 桌号输入校验不足（LOW）

**文件**：`xiaochengxu/pages/order/order.js`

**问题**：`tableId` 通过 `options.tableId` / `scene` 传入，仅做简单 `replace(/[^\d]/g, '')` 过滤。

```js
const tableId = String(rawTableId).replace(/[^\d]/g, '');
```

**建议**：增加后端校验兜底；前端对 `tableId` 做类型和范围校验（正整数、合理长度）。

---

### 2.4 请求 URL 白名单缺失（LOW）

**文件**：`xiaochengxu/utils/request.js`

**问题**：允许传入完整 URL。

```js
const requestUrl = options.url.startsWith('http') ? options.url : config.baseURL + options.url;
```

**建议**：限制外部 URL 只能访问白名单域名；或禁止传入完整 URL，统一走 `baseURL` 拼接。

---

## 三、商家端（admin-web）问题

### 3.1 `dangerouslySetInnerHTML` XSS 风险（MEDIUM）

**文件**：`admin-web/src/pages/Login.tsx`

**问题**：直接渲染后端返回的验证码 SVG。

```tsx
<span dangerouslySetInnerHTML={{ __html: captcha.svg }} />
```

**风险**：若后端被攻破或存在漏洞，恶意 SVG 可执行 JavaScript。

**建议**：改用 `<img src={`data:image/svg+xml;base64,${btoa(svg)}`} />` 或纯文本渲染。

---

### 3.2 WebSocket Token 明文暴露（MEDIUM）

**文件**：`admin-web/src/components/WebSocketProvider.tsx`

**问题**：与小程序端相同，token 作为 query 参数。

```ts
wsURL = `ws://localhost:3000/ws?token=${token}`
```

**建议**：改用 `Sec-WebSocket-Protocol` header 或短期 ticket 机制。

---

### 3.3 localStorage 明文存储敏感信息（MEDIUM）

**文件**：`admin-web/src/stores/auth.ts`

**问题**：Token 和用户信息明文存储在 `localStorage`。

```ts
localStorage.setItem('admin_token', token)
localStorage.setItem('admin_user', JSON.stringify(user))
```

**风险**：XSS 攻击可直接读取 `localStorage` 获取 token。

**建议**：敏感数据使用 `sessionStorage` 或加密存储；设置合理 token 过期时间。

---

### 3.4 `resolveImageUrl` 协议校验缺失（LOW）

**文件**：`admin-web/src/utils/image-url.ts`

**问题**：未对输入 URL 做协议白名单校验。

```ts
if (/^https?:\/\//i.test(raw)) return raw
return raw.startsWith('/') ? raw : '/' + raw
```

**风险**：若后端返回 `javascript:alert(1)` 或 `data:text/html,<script>...`，可能导致 DOM-based XSS。

**建议**：增加协议白名单校验（只允许 `http/https/相对路径`），过滤 `javascript:` / `data:` 等危险协议。

---

### 3.5 前端权限校验不可信（LOW）

**文件**：`admin-web/src/pages/EmployeeManage.tsx`

**问题**：删除/重置密码操作仅前端校验 `isSelf`。

```ts
if (employee.id === myId) {
  showToast('不能删除自己的账号', 'warning')
  return
}
```

**风险**：前端校验可被绕过。

**建议**：前端校验仅为 UX，确保后端接口有严格的权限校验和归属验证。

---

## 四、正面安全实践（值得保持）

### 4.1 后端
- 请求统一走 `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`，自动剥离未定义字段。
- 错误统一由 `AllExceptionsFilter` 处理，不在 controller 中 try/catch 返回业务错误。
- 审计 / 通知 / 打印 / 导出 失败必须吞错，不冒泡到订单主流程。
- `LocalImageCleanupService` 做路径白名单，防止路径穿越。

### 4.2 小程序端
- 无硬编码密钥，`config.js` 中无敏感密钥。
- 请求统一封装在 `request.js`，统一处理 401/404/500 错误。
- WebSocket 重连有上限（最大 5 次），指数退避。
- 图片 URL 过滤临时文件（`__tmp__` 和 `tmp/`）。

### 4.3 商家端
- 请求统一封装在 `request.ts`，统一处理 401/403 错误和 token 刷新。
- RBAC 权限矩阵 `PERMISSION_MATRIX` 与后端权限模型保持一致。
- `RoleGuard` 路由守卫：未授权角色直接跳转 `/forbidden`。
- 验证码防刷：登录失败触发验证码，连续失败锁定提示。
- 强制改密机制：临时密码登录后强制修改密码，`token_version` 自增使旧 token 失效。
- WebSocket 重连安全：4001 认证失败停止重连，避免无效连接风暴。

---

## 五、修复优先级建议

| 优先级 | 问题 | 涉及端 |
| --- | --- | --- |
| **P0（立即）** | SQL 注入（`mysql-event-outbox.adapter.ts`） | 后端 |
| **P1（本周）** | `dangerouslySetInnerHTML` XSS | 商家端 |
| **P1（本周）** | WebSocket Token 明文暴露 | 小程序端 + 商家端 |
| **P1（本周）** | localStorage 明文存储 token | 商家端 |
| **P1（本周）** | 用户名大小写敏感锁定绕过 | 后端 |
| **P1（本周）** | 验证码错误不计入失败次数 | 后端 |
| **P2（后续）** | `resolveImageUrl` 协议校验 | 商家端 |
| **P2（后续）** | 桌号输入校验 | 小程序端 |
| **P2（后续）** | N+1 查询 / 大偏移分页 | 后端 |
| **P2（后续）** | 请求 URL 白名单 | 小程序端 |
| **P2（后续）** | 前端权限校验不可信 | 商家端 |

---

## 六、数据库性能优化建议

| 问题 | 位置 | 建议 |
| --- | --- | --- |
| N+1 查询 | `orders.service.ts` | 使用 JOIN 或批量 IN 查询 |
| 大偏移分页 | `orders.service.ts` | 采用游标分页或限制最大偏移 |
| 缺少索引 | `orders` 表 | 为 `status`、`created_at`、`table_id` 添加复合索引 |
| 事务内嵌套查询 | `orders.service.ts` | 减少事务内查询次数，提前准备数据 |

---

