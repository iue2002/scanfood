# Requirements Document

## Introduction

商家运营中心（Merchant Ops Center）是商家后台 admin-web 中新增的运营管理模块，目标是把"员工/角色管理、通知偏好、数据导出、打印设置"这四类与日常运营强相关的能力收敛到一个集中入口下，由店主和经理统一治理。

本期范围：

1. **员工与角色管理（核心）**：基于 RBAC 的员工账号 CRUD，预置 4 种角色（店主 / 经理 / 收银员 / 服务员），并通过审计日志追溯关键操作。
2. **通知偏好设置**：声音提示开关与音色选择、桌面通知事件订阅、试听音色。
3. **数据导出**：订单 Excel 导出（按时间范围）、营业日报/月报 PDF 导出。
4. **打印设置**：云打印机连接（首期飞鹅打印机优先）、可勾选字段的小票模板、试打印、新订单自动打印开关、失败重试与离线队列。

排班表功能在用户侧确认下放入二期，不在本期范围内。

业务零修改红线：本模块禁止改动现有共享购物车、WebSocket、订单锁定、桌号释放等机制；只允许扩展新表（如 `audit_logs`、`user_preferences`、`printer_configs`、`print_jobs`）和扩展 `users.role` 枚举值，不允许重命名或删除现存字段与接口。

## Glossary

- **Merchant_Ops_Center**: 商家运营中心模块整体，承载员工管理、通知设置、数据导出、打印设置 4 个子域。
- **Employee_Manager**: 员工管理子系统，负责员工账号 CRUD 与会话失效。
- **RBAC_System**: 基于角色的权限控制子系统，包含后端 NestJS Guards、`@Roles()`/`@Permissions()` 装饰器与前端路由/组件守卫。
- **Audit_Logger**: 审计日志子系统，负责通过 NestJS Interceptor 自动记录关键写操作并提供查询。
- **Notification_Preference_Manager**: 通知偏好子系统，管理用户级声音/桌面通知开关与音色选择。
- **Notification_Center**: 现有的 admin-web `NotificationCenter` 组件，负责播放声音、弹出桌面通知与 toast。
- **Data_Exporter**: 数据导出子系统，提供订单 Excel 导出与营业报表 PDF 导出。
- **Print_Manager**: 打印子系统，包含云打印机配置、模板渲染、试打印、自动打印与失败重试。
- **Print_Job_Queue**: 打印任务队列，承载打印失败重试与离线缓存。
- **Owner**: 角色"店主"，拥有全部权限，包括员工与角色管理；系统至少保留一个未禁用的 Owner。
- **Manager**: 角色"经理"，除员工/角色管理外的全部权限。
- **Cashier**: 角色"收银员"，仅可结账、加菜、查看订单、查看桌台。
- **Waiter**: 角色"服务员"，仅可上菜、查看桌台。
- **Operator**: 当前发起请求的已登录员工。
- **Role_Set**: 系统支持的角色集合 = { Owner, Manager, Cashier, Waiter, admin（保留兼容）, customer（保留兼容） }。
- **Audit_Action**: 关键操作名（枚举），如 `EMPLOYEE_CREATE`、`EMPLOYEE_DELETE`、`EMPLOYEE_UPDATE_ROLE`、`PASSWORD_RESET`、`ORDER_CHECKOUT`、`ORDER_ADD_ITEM`、`MENU_ITEM_UPDATE`、`PRINTER_CONFIG_UPDATE`、`EXPORT_ORDERS`、`EXPORT_REPORT` 等。
- **Cloud_Printer**: 通过云打印协议（首期飞鹅）接入的小票打印机。
- **Print_Template**: 打印模板配置对象，包含可勾选字段（店头 / 桌号 / 菜品 / 合计 / 时间 等）。
- **Daily_Report**: 营业日报，覆盖单日的订单数、营业额、退款额、桌均、品类销量等。
- **Monthly_Report**: 营业月报，覆盖月度的订单数、营业额、退款额、桌均、品类销量、日维度趋势。
- **Forced_Logout**: 强制下线动作，使指定用户的现存 JWT 在服务端失效。

## Requirements

### Requirement 1: 角色与权限模型扩展

**User Story:** 作为店主，我希望系统提供 4 种预置角色与清晰的权限矩阵，以便不同岗位员工只能看到/操作各自被允许的功能。

#### Acceptance Criteria

1. THE RBAC_System SHALL 在后端 `users.role` 字段允许的取值集合中新增 `owner`、`manager`、`cashier`、`waiter` 四个值，并保留既有的 `admin` 与 `customer` 值以维持向后兼容。
2. THE RBAC_System SHALL 维护一份服务端权限矩阵，把每个 Audit_Action 与允许执行该动作的 Role_Set 子集做显式映射。
3. WHEN 后端启动时, THE RBAC_System SHALL 校验权限矩阵覆盖了所有挂有 `@Permissions()` 装饰器的路由，且发现未覆盖路由时阻止启动并输出未覆盖路由清单。
4. THE RBAC_System SHALL 把 Owner 视为 `admin` 的超集，使既有挂在 `admin` 角色下的接口对 Owner 同等放行。
5. WHEN Operator 调用任意带 `@Roles()` 或 `@Permissions()` 装饰器的接口, THE RBAC_System SHALL 在解析 JWT 之后、进入业务逻辑之前完成权限判定。
6. IF Operator 的角色不在该路由允许的 Role_Set 中, THEN THE RBAC_System SHALL 返回 HTTP 403 与 `{ code: 403, msg: 'FORBIDDEN', data: null }` 响应体。
7. THE RBAC_System SHALL 在前端提供 `useHasPermission(action: AuditAction)` Hook，返回布尔值供组件用于按钮/路由守卫。
8. WHERE 路由配置标注 `requiredRole`, THE RBAC_System SHALL 在 admin-web 路由进入前进行客户端校验，对越权访问重定向到 `/forbidden` 页面。

### Requirement 2: 员工列表与账号 CRUD

**User Story:** 作为店主，我希望在员工管理页面对员工账号进行新增、查看、编辑、禁用与删除，以便维护门店的人员名册。

#### Acceptance Criteria

1. WHEN Operator 是 Owner 且请求 `GET /api/merchant-ops/employees`, THE Employee_Manager SHALL 返回所有非 `customer` 角色用户的分页列表，字段包括 `id`、`username`、`nickname`、`role`、`status`、`created_at`、`last_login_at`。
2. WHEN Operator 是 Owner 且请求 `POST /api/merchant-ops/employees` 创建员工, THE Employee_Manager SHALL 校验 `username` 在 `users` 表内全局唯一，校验 `role ∈ { Manager, Cashier, Waiter, Owner }`，并以 bcrypt 哈希后写入 `password` 字段。
3. IF 创建员工时 `username` 已存在, THEN THE Employee_Manager SHALL 返回 HTTP 409 与 `code: 'USERNAME_TAKEN'`。
4. WHEN Operator 是 Owner 且请求 `PATCH /api/merchant-ops/employees/:id` 修改员工资料, THE Employee_Manager SHALL 允许更新 `nickname`、`role`、`status` 字段，禁止通过该接口修改 `password`。
5. WHEN Operator 是 Owner 且请求 `DELETE /api/merchant-ops/employees/:id`, THE Employee_Manager SHALL 在事务内将该员工标记为软删除（`status = 'deleted'`、`deleted_at = now()`）并触发 Forced_Logout。
6. THE Employee_Manager SHALL 对所有员工 CRUD 接口同步写入一条 Audit_Action 记录到 Audit_Logger。
7. WHERE Operator 角色为 Owner 之外的任意角色, THE Employee_Manager SHALL 拒绝调用员工 CRUD 接口并返回 HTTP 403。
8. WHEN admin-web 员工列表页加载, THE Employee_Manager SHALL 支持按 `role`、`status`、`username` 关键字过滤，并支持分页大小 ∈ {10, 20, 50}。

### Requirement 3: 唯一店主保护

**User Story:** 作为店主，我希望系统始终保留至少一个有效的店主账号，以避免因误操作导致整个门店失去最高管理权。

#### Acceptance Criteria

1. THE Employee_Manager SHALL 维护"未禁用 Owner 数量"不变量，使该数量在任何成功操作完成后不少于 1。
2. IF 删除、禁用或降权 Operator 之外的某位 Owner 会使未禁用 Owner 数量降至 0, THEN THE Employee_Manager SHALL 拒绝该操作并返回 HTTP 409 与 `code: 'LAST_OWNER_PROTECTED'`。
3. IF 创建账号请求中 `role = Owner` 且当前未禁用 Owner 数量已达到 5, THEN THE Employee_Manager SHALL 返回 HTTP 409 与 `code: 'OWNER_LIMIT_REACHED'`。
4. THE Employee_Manager SHALL 在删除、禁用、降权 Owner 的请求处理路径上以行级锁（`SELECT ... FOR UPDATE`）读取 Owner 计数，避免并发请求绕过不变量。

### Requirement 4: 自我操作约束

**User Story:** 作为已登录员工，我希望系统阻止我对自己的账号进行可能锁死后续操作的修改，以避免误把自己降权或删除。

#### Acceptance Criteria

1. IF Operator 调用 `DELETE /api/merchant-ops/employees/:id` 且 `:id == Operator.id`, THEN THE Employee_Manager SHALL 返回 HTTP 409 与 `code: 'SELF_DELETE_FORBIDDEN'`。
2. IF Operator 调用 `PATCH /api/merchant-ops/employees/:id` 且 `:id == Operator.id` 且新 `role` 在权限矩阵中不是 Operator 当前 `role` 的超集或同等集, THEN THE Employee_Manager SHALL 返回 HTTP 409 与 `code: 'SELF_DEMOTE_FORBIDDEN'`。
3. WHERE Operator 修改自身资料, THE Employee_Manager SHALL 仍允许修改 `nickname`、`avatar_url`，但拒绝修改自身 `status`。
4. THE Employee_Manager SHALL 在 admin-web 员工列表中对当前登录用户所在行禁用"删除"和"降权"按钮，并在 hover 时提示原因。

### Requirement 5: 强制下线与会话失效

**User Story:** 作为店主，我希望删除或禁用员工后该员工的所有现存登录立即失效，以避免离职员工继续操作系统。

#### Acceptance Criteria

1. THE Employee_Manager SHALL 在 `users` 表新增 `token_version: int default 0` 字段。
2. WHEN 员工被删除、禁用或重置密码, THE Employee_Manager SHALL 将该员工的 `token_version` 自增 1。
3. THE RBAC_System SHALL 在 JWT payload 中携带签发时的 `token_version`，并在 `JwtAuthGuard` 中校验 JWT 中的 `token_version` 等于数据库当前值。
4. IF JWT 中的 `token_version` 与数据库当前值不一致, THEN THE RBAC_System SHALL 返回 HTTP 401 与 `code: 'SESSION_REVOKED'`。
5. WHEN admin-web 收到 `code: 'SESSION_REVOKED'`, THE Notification_Center SHALL 弹出"账号已在其他位置失效"提示并跳转到登录页。
6. WHERE 客户端连接了 WebSocket, THE Employee_Manager SHALL 在 `token_version` 自增后通知 WebSocket 网关断开该用户的所有现存连接。

### Requirement 6: 员工密码管理

**User Story:** 作为店主，我希望可以为员工重置密码并要求员工首次登录修改密码，以保证密码安全。

#### Acceptance Criteria

1. WHEN Operator 是 Owner 且请求 `POST /api/merchant-ops/employees/:id/reset-password`, THE Employee_Manager SHALL 生成 12 位随机临时密码，使用 bcrypt（cost ≥ 10）哈希后写入，并将 `must_change_password` 标记置为 `true`。
2. THE Employee_Manager SHALL 在重置密码响应体中明文返回该临时密码一次，并在响应头 `Cache-Control: no-store` 防止中间缓存。
3. WHEN 员工使用临时密码登录且 `must_change_password = true`, THE RBAC_System SHALL 在登录响应中返回 `requirePasswordChange: true`，admin-web 收到后跳转到强制改密页。
4. WHEN 员工通过 `POST /api/merchant-ops/employees/me/change-password` 修改密码, THE Employee_Manager SHALL 校验新密码长度 ∈ [8, 64] 且包含字母与数字，更新哈希值，将 `must_change_password` 置为 `false`，并自增 `token_version`。
5. IF 重置密码请求的目标员工是发起者本人, THEN THE Employee_Manager SHALL 返回 HTTP 409 与 `code: 'USE_CHANGE_PASSWORD'`。
6. THE Employee_Manager SHALL 在密码相关响应、日志、审计 payload 中均不包含明文新旧密码（重置接口的一次性返回除外）。

### Requirement 7: 审计日志写入

**User Story:** 作为店主，我希望对每个员工的关键写操作都留有可追溯记录，以便事后排查问题与责任划分。

#### Acceptance Criteria

1. THE Audit_Logger SHALL 创建 `audit_logs` 表，字段包括 `id (PK)`、`actor_user_id`、`actor_role`、`action (varchar)`、`target_type`、`target_id`、`payload_json (json)`、`ip_address`、`user_agent`、`created_at`。
2. THE Audit_Logger SHALL 通过 NestJS Interceptor 自动捕获所有挂有 `@Audit(action)` 装饰器的接口调用，在主事务提交成功后异步写入一条审计记录。
3. THE Audit_Logger SHALL 至少在以下动作上挂 `@Audit`: 员工增/删/改/重置密码、改菜品（菜品 CRUD）、订单结账、订单加菜、订单退款、打印模板修改、打印机配置修改、订单导出、报表导出、通知偏好修改。
4. IF 主请求事务回滚, THEN THE Audit_Logger SHALL 不写入对应审计记录。
5. THE Audit_Logger SHALL 在 `payload_json` 中只保存与该 Audit_Action 相关的关键字段差异（before/after），且字段长度上限为 8 KB。
6. WHEN `payload_json` 序列化结果超过 8 KB, THE Audit_Logger SHALL 截断 `before/after` 中的字符串字段并在 `payload_json._truncated = true` 标记。
7. FOR ALL `payload_json` 对象, THE Audit_Logger SHALL 满足"序列化再反序列化等价于原对象"的往返性质（round-trip）。
8. THE Audit_Logger SHALL 在 `ip_address` 与 `user_agent` 字段使用请求头 `X-Forwarded-For`（取第一个非内网 IP）与 `User-Agent`，并在缺失时写入 `'unknown'`。

### Requirement 8: 审计日志查询与归档

**User Story:** 作为店主或经理，我希望能在管理页面按员工、按时间、按动作类型查询审计日志，并避免日志表无限增长拖慢系统。

#### Acceptance Criteria

1. WHEN Operator 角色 ∈ { Owner, Manager } 且请求 `GET /api/merchant-ops/audit-logs`, THE Audit_Logger SHALL 支持按 `actor_user_id`、`action`、`target_type`、`created_at` 区间过滤，返回分页结果。
2. THE Audit_Logger SHALL 默认按 `created_at` 倒序返回，分页大小 ∈ {20, 50, 100}，最大返回上限 1000 条。
3. WHERE 查询时间区间长度超过 90 天, THE Audit_Logger SHALL 拒绝并返回 `code: 'RANGE_TOO_LARGE'`。
4. THE Audit_Logger SHALL 对 `audit_logs` 表 `(actor_user_id, created_at)`、`(action, created_at)`、`(target_type, target_id)` 建立复合索引。
5. THE Audit_Logger SHALL 提供归档作业，把 `created_at < now() - 180 天` 的记录迁移到 `audit_logs_archive` 表并从主表删除，可按 cron 配置（默认每日 02:00 执行）。
6. WHILE 归档作业运行, THE Audit_Logger SHALL 以单批最多 5000 行的方式分批迁移，避免长事务阻塞写入。

### Requirement 9: 通知声音与音色设置

**User Story:** 作为收银员或店主，我希望能开启/关闭新订单声音提示并选择音色，以便在嘈杂环境下也能听清通知。

#### Acceptance Criteria

1. THE Notification_Preference_Manager SHALL 创建 `user_preferences` 表，字段包括 `user_id (PK)`、`sound_enabled boolean`、`sound_id varchar`、`desktop_events json`、`updated_at`。
2. WHEN Operator 请求 `GET /api/merchant-ops/notification-preferences/me`, THE Notification_Preference_Manager SHALL 返回当前用户的偏好；不存在记录时返回默认值 `{ sound_enabled: true, sound_id: 'default', desktop_events: ['NEW_ORDER'] }`。
3. WHEN Operator 请求 `PUT /api/merchant-ops/notification-preferences/me`, THE Notification_Preference_Manager SHALL 校验 `sound_id` 在内置音色清单内，校验 `desktop_events ⊆ { NEW_ORDER, ADD_ITEM, REFUND }`，并 upsert 到 `user_preferences`。
4. THE Notification_Preference_Manager SHALL 提供 `GET /api/merchant-ops/notification-preferences/sounds` 返回内置音色清单 `[{ id, label, url, durationMs }]`，其中 `url` 指向 TOS 对象存储。
5. WHEN 新订单事件到达 admin-web Notification_Center, THE Notification_Center SHALL 仅当当前用户偏好 `sound_enabled = true` 时播放 `sound_id` 对应音频。
6. WHEN admin-web 加载偏好后, THE Notification_Center SHALL 把 `sound_enabled` 与 `sound_id` 缓存到 `localStorage` 键 `mop:notif-pref`，并在偏好接口请求失败时回退到 localStorage。

### Requirement 10: 桌面通知事件订阅与试听

**User Story:** 作为店主，我希望能选择哪些事件触发浏览器桌面通知并能立刻试听音色，以便按门店实际节奏定制提醒。

#### Acceptance Criteria

1. WHEN Operator 在通知设置页勾选事件 ∈ { 新订单, 加餐, 退款 } 并保存, THE Notification_Preference_Manager SHALL 把对应事件键写入 `desktop_events` 数组。
2. WHEN admin-web 收到 WebSocket 事件 `e ∈ desktop_events` 且浏览器 `Notification.permission === 'granted'`, THE Notification_Center SHALL 调用 `new Notification(...)` 弹出桌面通知。
3. IF `Notification.permission === 'default'` 且用户尝试启用任意桌面事件, THEN THE Notification_Center SHALL 在保存前调用 `Notification.requestPermission()`。
4. IF `Notification.requestPermission()` 返回 `denied`, THEN THE Notification_Preference_Manager SHALL 拒绝把 `desktop_events` 设置为非空，并在 admin-web 显示"已被浏览器拒绝，请在站点设置中启用"提示。
5. WHEN Operator 在设置页点击"试听"按钮, THE Notification_Center SHALL 用当前选中的 `sound_id` 对应 URL 播放一次完整音色，时长不超过 3 秒。
6. IF 试听音频在 5 秒内加载失败或解码失败, THEN THE Notification_Center SHALL 降级为播放内置默认音色，并在界面提示"音色加载失败，已降级"。
7. WHEN 收到新订单事件但音色加载失败, THE Notification_Center SHALL 仍弹出 toast 与桌面通知，仅放弃声音播放，确保通知不漏。

### Requirement 11: 订单数据 Excel 导出

**User Story:** 作为店主或经理，我希望按时间范围把订单数据导出成 Excel，以便对账和上传到外部系统。

#### Acceptance Criteria

1. WHEN Operator 角色 ∈ { Owner, Manager } 且请求 `POST /api/merchant-ops/exports/orders`, THE Data_Exporter SHALL 接收 `{ startAt: ISO8601, endAt: ISO8601, status?: OrderStatus[] }` 参数。
2. THE Data_Exporter SHALL 校验 `startAt < endAt` 且 `endAt - startAt ≤ 92 天`，否则返回 `code: 'RANGE_INVALID'`。
3. THE Data_Exporter SHALL 在 Excel 中输出列 `订单号、桌号、下单时间、状态、菜品明细、金额、退款、操作员`，时间字段使用 `YYYY-MM-DD HH:mm:ss` 文本格式，金额字段使用数值格式两位小数。
4. WHEN 命中订单数 ≤ 5000, THE Data_Exporter SHALL 同步生成 `.xlsx`（ExcelJS）并以 `Content-Disposition: attachment` 直接返回。
5. WHEN 命中订单数 > 5000, THE Data_Exporter SHALL 转为异步任务，返回 `{ jobId }`，并以 ExcelJS streaming workbook 模式分批写入临时文件，最终通过 `GET /api/merchant-ops/exports/:jobId/download` 提供下载链接。
6. THE Data_Exporter SHALL 在异步任务执行期间提供 `GET /api/merchant-ops/exports/:jobId` 返回 `{ status: 'pending' | 'running' | 'success' | 'failed', progress: 0..100 }`。
7. THE Data_Exporter SHALL 写入审计日志 `EXPORT_ORDERS`，`payload_json` 包含 `{ startAt, endAt, rowCount, jobId }` 但不含订单明细。
8. IF 导出过程中数据库查询失败或文件写入失败, THEN THE Data_Exporter SHALL 把任务置为 `failed`、记录错误码，并在 24 小时后自动清理临时文件。

### Requirement 12: 营业报表 PDF 导出

**User Story:** 作为店主，我希望生成日报和月报 PDF，以便分享给合伙人和留档。

#### Acceptance Criteria

1. WHEN Operator 角色 ∈ { Owner, Manager } 且请求 `POST /api/merchant-ops/exports/reports`, THE Data_Exporter SHALL 接收 `{ type: 'DAILY' | 'MONTHLY', date: 'YYYY-MM-DD' | 'YYYY-MM' }` 参数。
2. WHERE `type = 'DAILY'`, THE Data_Exporter SHALL 生成包含订单数、营业额、退款额、桌均、品类销量、Top10 菜品的 Daily_Report PDF。
3. WHERE `type = 'MONTHLY'`, THE Data_Exporter SHALL 生成 Monthly_Report PDF，并额外包含按日维度的趋势图。
4. THE Data_Exporter SHALL 使用 HTML 模板 + Puppeteer 渲染 PDF，HTML 模板存放于后端 `templates/reports/*.hbs`。
5. THE Data_Exporter SHALL 在 PDF 页眉显示门店名（来自 `store_settings.store_name`）、生成时间、生成人 nickname。
6. WHEN PDF 渲染完成, THE Data_Exporter SHALL 以 `application/pdf` 与 `Content-Disposition: attachment; filename="report-<type>-<date>.pdf"` 返回，文件大小上限 20 MB。
7. IF Puppeteer 启动失败或渲染超过 60 秒, THEN THE Data_Exporter SHALL 返回 `code: 'REPORT_GENERATION_FAILED'`，并记录失败原因到审计日志。
8. THE Data_Exporter SHALL 写入审计日志 `EXPORT_REPORT`，`payload_json` 包含 `{ type, date, rowCount }`。

### Requirement 13: 云打印机连接与配置

**User Story:** 作为店主，我希望把门店的小票打印机接入系统并管理多台打印机，以便后厨/前台分单出票。

#### Acceptance Criteria

1. THE Print_Manager SHALL 创建 `printer_configs` 表，字段包括 `id (PK)`、`name`、`provider ('FEIE' | 'BLUETOOTH' | 'BROWSER')`、`device_sn`、`device_key`、`role ('CASHIER' | 'KITCHEN' | 'BOTH')`、`enabled`、`auto_print`、`template_id`、`created_at`、`updated_at`。
2. WHEN Operator 角色 ∈ { Owner, Manager } 且请求 `POST /api/merchant-ops/printers`, THE Print_Manager SHALL 校验 `provider = 'FEIE'` 时 `device_sn` 与 `device_key` 都非空，并调用飞鹅云 API 注册打印机。
3. IF 飞鹅云 API 返回错误, THEN THE Print_Manager SHALL 不写入 `printer_configs`，返回 HTTP 502 与上游错误码透传到 `code` 字段。
4. WHEN Operator 请求 `GET /api/merchant-ops/printers`, THE Print_Manager SHALL 返回当前门店所有打印机及其在线状态（通过云 API 实时查询）。
5. WHERE `provider = 'BROWSER'`, THE Print_Manager SHALL 在 admin-web 端用 `window.print()` 渲染打印模板的 HTML 视图作为备选方案。
6. THE Print_Manager SHALL 在 `printer_configs` 中对 `device_key` 字段使用 AES-256 加密存储，且不在任何 `GET` 接口中返回明文。
7. THE Print_Manager SHALL 写入审计日志 `PRINTER_CONFIG_UPDATE` 记录配置变更。

### Requirement 14: 打印模板与字段勾选

**User Story:** 作为店主，我希望选择小票上要打印哪些字段并预览效果，以便适配不同门店的小票样式偏好。

#### Acceptance Criteria

1. THE Print_Manager SHALL 创建 `print_templates` 表，字段包括 `id`、`name`、`fields_json (json)`、`width ('58mm' | '80mm')`、`updated_at`。
2. THE Print_Manager SHALL 把 `fields_json` 视为可勾选字段集合的子集，候选字段为 `{ STORE_NAME, TABLE_NUMBER, ITEMS, TOTAL, TIME, ORDER_NO, REMARK, OPERATOR }`。
3. WHEN Operator 请求 `PUT /api/merchant-ops/print-templates/:id`, THE Print_Manager SHALL 校验 `fields_json` 至少包含 `{ TABLE_NUMBER, ITEMS, TOTAL }`，否则返回 `code: 'TEMPLATE_INVALID'`。
4. THE Print_Manager SHALL 提供"打印预览"接口 `POST /api/merchant-ops/print-templates/:id/preview`，根据传入示例订单生成 ESC/POS 文本预览（用于云打印）与 HTML 预览（用于浏览器打印）。
5. FOR ALL 合法的 Print_Template 与 Order 输入, THE Print_Manager SHALL 满足`renderToEscPos(template, order)` → 解析 → 反序列化字段集合 = `template.fields_json` 的往返性质（round-trip 解析/打印一致性）。
6. THE Print_Manager SHALL 在 admin-web 提供模板编辑界面，使用 Tailwind + 现有 UI 组件（Card / Switch / Button），不得手搓样式。

### Requirement 15: 试打印

**User Story:** 作为店主，我希望保存打印机配置后能立刻试打印一张样张，以便确认设备已正常工作。

#### Acceptance Criteria

1. WHEN Operator 角色 ∈ { Owner, Manager } 且请求 `POST /api/merchant-ops/printers/:id/test-print`, THE Print_Manager SHALL 渲染当前 `template_id` 对应模板的样张订单并下发到指定打印机。
2. THE Print_Manager SHALL 在 5 秒内向调用方返回 `{ accepted: boolean, providerJobId?: string, errorCode?: string }`，不等待物理打印完成。
3. IF 调用云打印 API 在 5 秒内未返回, THEN THE Print_Manager SHALL 中止等待并返回 `code: 'UPSTREAM_TIMEOUT'`，同时把任务推入 Print_Job_Queue 重试。
4. THE Print_Manager SHALL 把试打印结果写入审计日志 `PRINTER_TEST`，`payload_json` 包含 `{ printerId, templateId, accepted, errorCode }`。
5. WHILE 试打印 API 调用进行中, THE Print_Manager SHALL 在 admin-web 显示按钮 loading 态，避免重复点击重复出票。

### Requirement 16: 自动打印开关

**User Story:** 作为店主，我希望能开启"新订单自动出小票"，以便后厨实时收单。

#### Acceptance Criteria

1. WHERE `printer_configs.auto_print = true` 且 `enabled = true`, THE Print_Manager SHALL 在新订单事件到达后台事件总线时，自动用该打印机的 `template_id` 打印。
2. WHEN 同一订单触发多台 `auto_print = true` 的打印机, THE Print_Manager SHALL 按 `printer_configs.role` 拆单（CASHIER 打全票，KITCHEN 仅打 ITEMS 字段）。
3. WHEN Operator 关闭某台打印机的 `auto_print`, THE Print_Manager SHALL 从下一笔订单开始停止向该打印机自动派单，正在排队的任务继续完成。
4. THE Print_Manager SHALL 写入审计日志 `PRINTER_AUTO_PRINT_TOGGLE` 记录开关变更，`payload_json` 包含 `{ printerId, before, after }`。
5. THE Print_Manager SHALL 不修改既有订单状态机；自动打印失败不阻塞订单创建与桌号释放等业务流程。

### Requirement 17: 打印失败重试与离线队列

**User Story:** 作为店主，我希望打印机暂时离线或故障时打印任务能自动重试，以便恢复后能补打。

#### Acceptance Criteria

1. THE Print_Manager SHALL 创建 `print_jobs` 表，字段包括 `id`、`printer_id`、`template_id`、`payload_json`、`status ('PENDING' | 'SENT' | 'SUCCESS' | 'FAILED')`、`attempt`、`last_error`、`next_retry_at`、`created_at`、`updated_at`。
2. WHEN 打印任务因网络或上游错误失败, THE Print_Manager SHALL 以指数退避（30s、2min、10min）最多重试 3 次。
3. IF 3 次重试后仍失败, THEN THE Print_Manager SHALL 把任务置为 `FAILED` 并通过 WebSocket 推送 `printer:error` 事件给所有 Owner/Manager 的 admin-web 在线连接。
4. WHILE 打印机标记为离线, THE Print_Manager SHALL 暂停向该打印机派发新任务，所有任务保持 `PENDING` 入队等待恢复。
5. WHEN 打印机恢复在线（轮询或回调发现）, THE Print_Manager SHALL 按 `created_at` 升序重新派发该打印机所有 `PENDING` 任务，单批最多 50 条。
6. THE Print_Manager SHALL 在 `print_jobs` 中保留近 7 天数据，超过的记录由归档作业删除。
7. WHEN admin-web 访问打印机详情页, THE Print_Manager SHALL 提供 `print_jobs` 最近 100 条记录用于排查。

### Requirement 18: 模块路由与导航集成

**User Story:** 作为已登录的店主或经理，我希望能在 admin-web 侧边栏看到"运营中心"入口并按权限进入对应子页面，以便统一管理这些设置。

#### Acceptance Criteria

1. WHEN admin-web 启动, THE Merchant_Ops_Center SHALL 在 `Sidebar` 注册"运营中心"一级菜单与四个二级菜单：员工管理、通知设置、数据导出、打印设置。
2. WHERE 当前用户角色 ∈ { Cashier, Waiter }, THE Merchant_Ops_Center SHALL 隐藏"运营中心"一级菜单。
3. WHERE 当前用户角色 = Manager, THE Merchant_Ops_Center SHALL 隐藏"员工管理"二级菜单，但显示其余三个。
4. WHEN 用户直接访问被禁的运营中心子路由, THE RBAC_System SHALL 在路由守卫层重定向到 `/forbidden`。
5. THE Merchant_Ops_Center SHALL 复用现有 `Layout`、`Header`、`NotificationCenter`、`UnreadProvider` 组件，不得新建并行布局壳。

### Requirement 19: 现有业务零修改保证

**User Story:** 作为店主，我希望新增的运营中心绝不影响现有的下单/购物车/桌号/WebSocket 等业务流程，以避免上线引入回归。

#### Acceptance Criteria

1. THE Merchant_Ops_Center SHALL 不修改 `users` 表已有列的类型与名称，仅新增 `token_version`、`must_change_password`、`status`、`deleted_at` 列。
2. THE Merchant_Ops_Center SHALL 不修改既有 WebSocket 事件名与 payload 结构，所有新增事件以 `mop:` 前缀命名（如 `mop:printer-error`）。
3. THE Merchant_Ops_Center SHALL 不修改共享购物车、订单锁定、桌号释放相关的服务方法签名与事务边界。
4. WHERE 现有接口未挂 `@Audit` 装饰器, THE Audit_Logger SHALL 不改变其行为或响应格式。
5. WHEN 运营中心相关任意服务（导出、打印、审计）发生未捕获异常, THE Merchant_Ops_Center SHALL 在自身边界吞掉异常并仅写入错误日志，不让异常冒泡到订单创建主流程。

### Requirement 20: 非功能性要求（性能、安全、可观测）

**User Story:** 作为店主，我希望运营中心的接口在常见数据量下响应迅速、敏感信息得到妥善保护，并具备基本的可观测性，以便排查与扩展。

#### Acceptance Criteria

1. WHEN 数据库 `audit_logs` 表存量 ≤ 100 万行且查询时间区间 ≤ 30 天, THE Audit_Logger SHALL 在 P95 ≤ 800ms 内返回查询结果。
2. WHEN 数据库 `orders` 表对应区间命中行数 ≤ 5000, THE Data_Exporter SHALL 在 P95 ≤ 8 秒内完成同步 Excel 导出。
3. THE Merchant_Ops_Center SHALL 在结构化日志（pino/Winston）中为每条请求记录 `requestId`、`actorUserId`、`route`、`durationMs`、`statusCode`。
4. THE Merchant_Ops_Center SHALL 通过环境变量 `FEIE_USER`、`FEIE_UKEY`、`AES_KEY` 注入云打印密钥与本地加密密钥，禁止把密钥硬编码到源码或日志中。
5. THE Merchant_Ops_Center SHALL 对所有写接口启用 NestJS `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`，拒绝未声明字段。
6. THE Merchant_Ops_Center SHALL 对每个用户的导出接口（`exports/orders`、`exports/reports`）应用速率限制：单用户每分钟 ≤ 5 次，超出返回 HTTP 429 与 `code: 'RATE_LIMITED'`。
7. THE Merchant_Ops_Center SHALL 在 admin-web 上仅通过 `Network`/统一 axios 实例发起请求，沿用既有 `JwtAuthGuard` 的 `Authorization: Bearer <token>` 头，不引入新的鉴权方式。

### Requirement 21: 排班表二期占位

**User Story:** 作为店主，我希望系统为后续的排班功能预留可扩展位置，但本期不实现，以便聚焦更高优先级的能力。

#### Acceptance Criteria

1. THE Merchant_Ops_Center SHALL 在员工管理页面显示一个"排班表（即将推出）"占位 Tab，点击后展示"功能开发中"空状态，不发起任何 API 请求。
2. THE Merchant_Ops_Center SHALL 不在本期创建 `shifts` 等排班相关数据库表，避免引入不必要的迁移成本。
3. WHERE 二期需要扩展, THE Merchant_Ops_Center SHALL 在员工详情页底部预留 `<EmployeeShiftSection />` 组件挂载点，本期渲染为 `null`。
