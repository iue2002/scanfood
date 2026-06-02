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

- ✅ **P0-3 orders 状态机未接入**（commit 1bb4404）
  - 文件：`server/src/modules/orders/orders.service.ts` + `order-lifecycle.core.ts` + 新增 `order-lifecycle.core.spec.ts`
  - 已完成：① 新增 `OrderLifecycleCore.canTransition` 状态流转矩阵（终态不可转出/settled 仅限可结算态/cancelled 限未终态/refunded 不可手动设置），updateOrderStatus 写库前校验 ② markOrderAsPrinted 改带 `WHERE status='submitted'` 条件更新 + `nextStatusOnPrint`，消除 fire-and-forget 覆盖并发结账/取消的竞态与死代码 ③ 补状态机单测 8 个全过
  - 验证：build ✅；测试 119 passed（+8 新单测）/14 failed（基线环境型，无新失败）

### P1 — 正确性

- 🟦 **P1-1 金额浮点 → decimal/整数分（全局专项，影响面大）**
  - 文件：orders / carts / statistics / refunds / 前端 / 小程序
  - 注意：影响面广，需单独评估，可能拆多次提交。先不动 schema 列类型（红线），在计算层用整数分或 decimal 库
  - 进度：refunds 已在 P0-1 改整数分 ✅；statistics 已在 P1-2 改 SQL DECIMAL SUM ✅；orders 已在 P1-3 配套改整数分 ✅（commit f475317）；carts 已改整数分 ✅（commit fba4823）；**后端全部完成；剩余仅前端/小程序展示层（展示用 parseFloat 仅显示，风险低，可后置）**
- ✅ **P1-3 orders 其余正确性**（commit 0c781d3 + 金额 f475317）
  - syncDraft 草稿复用 bug：原 getTableCurrentOrder 不含 draft → 新增 getTableOccupyingOrder（含 draft）正确复用，修复草稿表膨胀 ✅
  - deleteOrder 状态数组漏 unpaid + 冗余 spread → 改用 OrderLifecycleCore.occupyingStatuses() ✅
  - getOrders 不返回 total → 改返回 {data,total,page,pageSize}，controller 透出，保持 res.data 数组兼容前端/小程序 ✅
  - markOrderAsPrinted 竞态已在 P0-3 修 ✅
  - orders 金额浮点 → 整数分 ✅
  - 验证：build ✅；测试 119/14 与基线一致
- ✅ **P1-2 statistics 全表内存聚合 → SQL GROUP BY**（commit 2b46e07）
  - 文件：`server/src/modules/statistics/statistics.service.ts`
  - 已完成：8 个接口全部下沉 SQL 聚合（GROUP BY/SUM/COUNT，参照 mop readonly-orders 范式）；金额用 SQL DECIMAL SUM 精确求和；日期边界改本地时区 00:00:00/23:59:59 修正 UTC 错位；修正按月 `new Date(end+'-31')` 非法月末；返回结构不变
  - 验证：build ✅；测试 119 passed/14 failed（基线，无新失败）
- ⬜ **P1-3 orders 其余正确性**
  - syncDraft 草稿复用 bug（getTableCurrentOrder 不含 draft，更新分支永远进不去）
  - markOrderAsPrinted 无条件覆盖状态的竞态
  - deleteOrder 硬编码状态数组漏 unpaid + 与状态机不一致
  - getOrders 不返回 total
- ✅ **P1-4 外部 HTTP 健壮性**（commit 10997fc）
  - 文件：`server/src/modules/wechat/wechat.service.ts`、`auth/auth.service.ts` getOpenIdFromCode
  - 已完成：wechat 三个裸 https（request/requestBinary/requestWithPost）加 10s 硬超时；getOpenIdFromCode 补 appId/secret/code 缺失校验 + 参数 encodeURIComponent + 10s 超时
  - **部署形态确认：单实例（pm2 单进程 scanfood-api:3000）** → wechat access_token 内存缓存安全，集中存储暂不做（多实例时再做）；同理 P2-8 内存幂等/限流单实例下 OK，暂缓
  - 验证：build ✅；测试 119/14 与基线一致
- ✅ **P1-5 auth 失败计数重置不落库**（commit ae863db）
  - 文件：`server/src/modules/auth/auth.service.ts` isAccountLocked
  - 已完成：超过重置窗口(10min)时改为持久化 `lockStore.delete(key)`，让"失败计数自动重置"真正生效（原先只改内存不落库，从未生效，只靠 30min TTL 兜底）
  - 验证：build ✅；集成测试失败数 14 与基线一致
  - 备注（可选未做）：账户锁定 DoS（用他人用户名+乱密码恶意锁定）需 IP+账号联合判定，按最小化原则暂不强行加，留待评估

### P2 — 工程化 / 可维护性

- ✅ **P2-1 抽公共工具**（commit 1cfeb67 + 9e194c0）：新增 `common/client-ip.ts`，employee/export/audit/auth controller + orders.gateway 统一改用 `extractClientIp`/`extractIpFromHeaders`，消除 5 处重复；log-sanitizer 由精确 Set 匹配改子串包含匹配（修复 accessToken/smtpPass 等驼峰条目永不命中），与 AuditCore.redact 口径对齐（AuditCore 受 PBT 约束未动）
- ✅ **P2-2 trust proxy 确认**（commit 1cfeb67）：main.ts `app.set('trust proxy', 1)` 信任第一跳 nginx/cpolar 反代，使 req.ip/限流/登录锁定/审计 IP 取真实客户端 IP（不设 true 防伪造）
- ✅ **P2-3 employee 临时密码**（commit cf5c134）：`genTempPassword` 改 `crypto.randomInt`（CSPRNG），输出契约不变，18 个 PBT 全过
- ✅ **P2-4 dishes updateSortOrder 包事务**（commit 04c7558）：原循环逐条 await（N 次往返+无事务）改为单条 SQL CASE WHEN 批量原子更新；id 经正整数过滤防御
- ✅ **P2-5 前端 RBAC 矩阵漂移**（commit 2458abe）：admin-web/rbac/types.ts 补全 13 个缺失 action，AuditAction 类型 + PERMISSION_MATRIX 与后端 merchant-ops/auth 完全一致（31 个 action）；tsc 通过
- ⬜ **P2-6 OrderManage 重构**：1420 行拆子组件 + WS 事件由全量重拉改增量更新/节流
- ✅ **P2-7 tables 建桌三步包事务**（commit 99b33a5）；dishes deleteCategory 悬空校验已在 P2-4 完成 ✅
  - createTable 的 insert tables + insert table_validations 改同事务原子写入；二维码生成保留事务外
- ⏭ **P2-8 进程内存幂等/限流横向扩展**（单实例部署，暂缓）
  - 部署已确认单实例（pm2 单进程），carts 幂等 / notif 限流 / wechat token 等进程内存方案当前安全。仅当未来切多实例/cluster 时才需改集中存储（Redis/DB）。

---

## 进度日志（每次提交后追加）

| 日期 | 任务 | commit | 备注 |
|------|------|--------|------|
| - | 建立 PLAN 文件 | 023482e | 仅 stage 本文件 |
| - | P0-1 refunds 资金安全加固 | 8532eb0 | 仅 stage refunds 3 文件；build✅；测试失败16→14（预存在环境型） |
| - | P0-2 orders 顾客端点越权(IDOR) | 22b560b | 仅 stage orders 2 文件；build✅；测试14/111与基线一致 |
| - | P0-3 orders 状态机校验+打印竞态 | 1bb4404 | orders 3 文件(含新单测)；build✅；119 passed/14 failed |
| - | P1-2 statistics SQL聚合重构 | 2b46e07 | statistics 1 文件；build✅；119/14 与基线一致；顺带修浮点+时区+月末 |
| - | P1-3 orders 正确性(草稿/删单/total) | 0c781d3 | orders 3 文件；build✅；119/14 一致 |
| - | P1-1(orders) 金额整数分 | f475317 | orders.service 1 文件；build✅；119/14 一致 |
| - | P1-1(carts) 金额整数分 | fba4823 | carts.service 1 文件；build✅；119/14 一致；后端金额浮点全清 |
| - | P1-4 外部HTTP超时+编码 | 10997fc | wechat+auth 2 文件；build✅；119/14 一致；确认单实例部署 |
| - | P1-5 auth失败计数重置落库 | ae863db | auth.service 1 文件；build✅；集成测试14与基线一致；P1全部完成 |
| - | P2-3 临时密码crypto随机 | cf5c134 | employee.core 1 文件；build✅；employee PBT 18/18 过 |
| - | P2-4 排序批量+删分类校验 | 04c7558 | dishes.service 1 文件；build✅；119/14 一致 |
| - | P2-7 建桌事务 | 99b33a5 | tables.service 1 文件；build✅；119/14 一致 |
| - | P2-1/P2-2 trust proxy+公共IP工具 | 1cfeb67 | 7 文件(新增client-ip)；build✅；119/14 一致 |
| - | P2-1 日志脱敏子串匹配 | 9e194c0 | log-sanitizer 1 文件；build✅；119/14 一致 |
| - | P2-5 前端RBAC矩阵补全 | 2458abe | admin-web rbac/types 1 文件；tsc✅ |
