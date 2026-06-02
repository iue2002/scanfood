# 生产级加固改造 PLAN（Kiro 工作追踪文件）

> 本文件是 Kiro 的任务记忆文件。每完成一项就更新状态标记。
> 即使会话上下文被压缩，重新读本文件即可恢复进度。

## 工作规则（CRITICAL — 不可违反）

1. **每修完一个小模块，本地 git 提交一次**，commit message 用中文，遵循 commitlint 规范（`fix:` / `feat:` / `refactor:` 等）。
2. **未经宝宝（用户）明确命令，绝不 `git push` 到 GitHub，绝不部署到服务器。** 只允许本地 commit。
3. 提交时**只 stage 本任务自己改动的文件**，不要把用户已有的未提交改动（notif-template 等）一起提交。
4. 改完跑验证：`cd server && npm test`、`cd server && npm run build`、`cd admin-web && npx tsc --noEmit`。
5. 遵守 AGENTS.md 红线：既有表只能 ADD COLUMN、跨切吞错、mop core 只注入 RepoPort、密钥走 env、WS 新事件 `mop:` 前缀。
6. 平台：Windows，命令分隔用 `;` 不用 `&&`。
7. **限流最小化原则（宝宝指令）**：能用优化/改进解决的，绝不靠粗暴限流挡。限流只设在「收益最大、最必要」的地方（如登录防爆破、退款防重等真正涉及安全/资金的入口）。普通业务接口优先通过 SQL/索引/缓存/幂等/并发控制等手段提升承载力，而不是简单加 rate limit。已有的低级粗糙限流（如纯内存计数）在重构时优先替换为更优方案或移除。

## 状态图例
- ⬜ 待办  🟦 进行中  ✅ 已完成（含本地提交）  ⏸ 阻塞/待确认  ⏭ 跳过

---

## 模块评级总表（审计结论，基线）

| 模块 | 评级 | 最严重问题 |
|------|------|-----------|
| B12 merchant-ops | A- | 临时密码用 Math.random |
| B11 notif | A- | 限流进程内存（多实例失效） |
| B9 upload | A- | heic 无魔数校验放行 |
| B13 基础设施 | A- | 两套脱敏并存 / CORS 硬编码 |
| B2 carts | A-/B+ | 内存幂等不支持多实例 |
| B7 store-settings | A-/B+ | store_settings 隐式单例 |
| B8 tables | B+ | 建桌三步无事务 |
| B1 auth | B | 微信API无超时、失败计数重置不落库 |
| B3 dishes | B | updateSortOrder 无事务批量 |
| B4 orders | C+ | 订单越权 IDOR、状态机没接、浮点金额 |
| B10 wechat | C+ | token 内存单例多实例失效、无超时 |
| B6 statistics | C | 全表内存聚合、浮点金额、时区 |
| B5 refunds | D+ | 无金额校验/无防重/操作人=0/无事务 |
| 前端 admin-web | B+ | OrderManage 全量重拉 + 1420行巨型组件 |
| 小程序 xiaochengxu | B+ | 强依赖全局 allDishes、浮点金额 |

---

## 修复任务清单（按优先级 + 状态）

### P0 — 资金 / 安全（最高优先，先修）

- ✅ **P0-1 refunds 资金安全加固**（commit 8532eb0）
  - 文件：`server/src/modules/refunds/refunds.service.ts` + controller + dto
  - 已完成：① 退款金额 ≤ 订单金额且累计(pending+approved)不超额，防超额/防重复 ② 防重复退款（订单已 refunded 拒绝）③ operator_id 从 JWT actor 注入（DTO 移除可伪造字段）④ refunds.status + orders.status 同事务 + 行锁 ⑤ 校验订单为 settled 才可退 ⑥ 金额改整数分规避浮点
  - 验证：build ✅；测试失败数 16→14（均为预存在的集成测试环境型 401，与本改动无关，且本改动反而减少 2 个失败）
  - 限流：未加，靠金额上限+防重+状态校验从逻辑杜绝滥用（符合最小化限流原则）

- ✅ **P0-2 orders 顾客端点越权（IDOR）**（commit 22b560b）
  - 文件：`server/src/modules/orders/orders.controller.ts` + `orders.service.ts`
  - 已完成：新增 `assertOrderAccess` 归属校验 —— 员工角色放行；顾客仅可访问「自己创建的订单」或「当前绑定桌台的订单」（保留同桌共享点单红线）；getOrderById/addOrderItem/removeOrderItem/updateOrderItemQuantity 四个顾客端点接入；controller 从 JWT 注入 actor，不信任前端
  - 验证：build ✅；测试 14 failed/111 passed，与基线一致无新失败
  - 红线：未破坏既有共享购物车/桌台协作机制

- ⬜ **P0-3 orders 状态机未接入**
  - 文件：`server/src/modules/orders/orders.service.ts` updateOrderStatus
  - 问题：OrderLifecycleCore.canSettle 定义了没调用，可把已结账订单改回任意状态
  - 改：updateOrderStatus 写库前用状态机校验合法流转；接上 nextStatusOnPrint（消除死代码）

### P1 — 正确性

- ⬜ **P1-1 金额浮点 → decimal/整数分（全局专项，影响面大）**
  - 文件：orders / carts / statistics / refunds / 前端 / 小程序
  - 注意：影响面广，需单独评估，可能拆多次提交。先不动 schema 列类型（红线），在计算层用整数分或 decimal 库
- ⬜ **P1-2 statistics 全表内存聚合 → SQL GROUP BY**
  - 文件：`server/src/modules/statistics/statistics.service.ts`
  - 改：getStatisticsByCategory/Day/Month/getDishRanking/getOverview 等下沉为 SQL 聚合 + 索引；修 `new Date(end+'-31')` 月边界 + UTC 时区
- ⬜ **P1-3 orders 其余正确性**
  - syncDraft 草稿复用 bug（getTableCurrentOrder 不含 draft，更新分支永远进不去）
  - markOrderAsPrinted 无条件覆盖状态的竞态
  - deleteOrder 硬编码状态数组漏 unpaid + 与状态机不一致
  - getOrders 不返回 total
- ⬜ **P1-4 外部 HTTP 健壮性**
  - 文件：`server/src/modules/wechat/wechat.service.ts`、`auth/auth.service.ts` getOpenIdFromCode
  - 改：https 调用加超时 + URL encodeURIComponent；wechat access_token 集中存储（DB）替代进程内存单例
- ⬜ **P1-5 auth 失败计数重置不落库**
  - 文件：`server/src/modules/auth/auth.service.ts` isAccountLocked
  - 改：重置后 set 回 store；评估账户锁定 DoS（IP+账号联合）

### P2 — 工程化 / 可维护性

- ⬜ **P2-1 抽公共工具**：统一 `extractClientIp(req)`（消除 4 处重复）、统一 https 客户端、合并 log-sanitizer 与 AuditCore.redact 两套脱敏
- ⬜ **P2-2 trust proxy 确认**：main.ts 是否需 `app.set('trust proxy', ...)`（影响所有 IP 限流/锁定准确性）
- ⬜ **P2-3 employee 临时密码**：`genTempPassword` 改 `crypto.randomInt`（密码学安全随机）
- ⬜ **P2-4 dishes updateSortOrder 包事务**：循环逐条 update → 事务 + 批量
- ⬜ **P2-5 前端 RBAC 矩阵漂移**：admin-web/rbac/types.ts 缺一堆 action，与后端手抄不一致 → 同步/共享
- ⬜ **P2-6 OrderManage 重构**：1420 行拆子组件 + WS 事件由全量重拉改增量更新/节流
- ⬜ **P2-7 tables 建桌三步包事务**；dishes deleteCategory 处理菜品悬空
- ⬜ **P2-8 进程内存幂等/限流横向扩展**（架构级，需先与宝宝确认是否多实例部署再决定是否做）

---

## 进度日志（每次提交后追加）

| 日期 | 任务 | commit | 备注 |
|------|------|--------|------|
| - | 建立 PLAN 文件 | 023482e | 仅 stage 本文件 |
| - | P0-1 refunds 资金安全加固 | 8532eb0 | 仅 stage refunds 3 文件；build✅；测试失败16→14（预存在环境型） |
| - | P0-2 orders 顾客端点越权(IDOR) | 22b560b | 仅 stage orders 2 文件；build✅；测试14/111与基线一致 |
