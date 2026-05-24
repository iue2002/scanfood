# AI 协作开发规范（CRITICAL）

> 这是给 AI 大模型看的项目真相文档。**写代码前必读**，避免基于错误假设给出误导建议。

## 项目实际结构

这是一个**三端独立子项目集合**，**根目录不安装任何依赖**：

```
projects/
├── xiaochengxu/    # 微信小程序顾客端（原生 wxml/wxss/js，非 Taro 非 React）
├── admin-web/      # 商家后台（Vite + React 18 + TailwindCSS 3 + axios + zustand）
├── server/         # 后端 API（NestJS 10 + Drizzle 0.45 + MySQL 8 + ws）
└── ...（文档、key、内网穿透指南等）
```

历史包袱：项目早期是 Taro 4 H5+小程序，后期重构为原生小程序 + admin-web 独立。所有 Taro / pnpm / shadcn-ui / `@/components/ui/*` / `@tarojs/components` / `lucide-react-taro` / `weapp-tailwindcss` 的痕迹都已移除。**如果在历史 commit / 文档里看到这些字眼，那是死代码，不是当前项目特征。**

## 包管理

- 根目录：**不装依赖**（package.json 只是 meta）
- `server/`：**npm**，`npm install` / `npm run dev` / `npm test`
- `admin-web/`：**npm**，`npm install` / `npm run dev` / `npm run build`
- `xiaochengxu/`：原生小程序，**无 node_modules**，用微信开发者工具打开

Node 锁定：`>=20 <23`（项目根 `.nvmrc=20`，两个子项目 `package.json` 都有 `engines`）。

## Git 提交规范

Commitlint 强制（看 commit history 风格）：

```
feat: 新增 X 功能
fix: 修复 X 问题
refactor: 重构 X
chore: 杂项（依赖治理 / 配置 / 文档）
style: 仅样式调整
perf: 性能优化
docs: 仅文档
test: 仅测试
```

中文 message 可读性优先；仅 mop 模块前缀化：`feat(merchant-ops): xxx`。

## 命名规范

- **文件名**：kebab-case（`employee-repo.drizzle.ts`、`audit.core.ts`）；React 组件文件 PascalCase（`Sidebar.tsx`、`PrinterManage.tsx`）
- **类 / 接口 / 类型**：PascalCase（`EmployeeCore`、`PrinterRow`）
- **变量 / 函数**：camelCase（`getOrDefault`、`runRetryTick`）
- **常量**：UPPER_SNAKE_CASE（`RETRY_DELAYS_MS`、`PAYLOAD_BYTE_LIMIT`）
- **CSS**：Tailwind utility classes（不是 CSS module / styled-components）

---

# 一、后端规范（server/）

## NestJS 项目结构

`server/` 用 **Hexagonal / Ports-and-Adapters** 架构（mop 模块尤其严格）：

```
src/modules/<feature>/
├── <feature>.controller.ts   # 路由 + DTO 校验
├── <feature>.dto.ts          # class-validator
├── <feature>.core.ts         # 纯业务规则类（无 I/O 依赖，可 PBT）
├── <feature>-repo.port.ts    # 持久化接口
├── <feature>-repo.drizzle.ts # Drizzle 实现
└── <feature>.property.spec.ts # fast-check 属性测试
```

## 路由前缀（CRITICAL）

`main.ts` 已 `app.setGlobalPrefix('api')`，所有路由自动加 `/api`。

```ts
// ✅ 正确
@Controller('users')         // → /api/users
@Controller('merchant-ops/employees')  // → /api/merchant-ops/employees

// ❌ 错误
@Controller('api/users')     // → /api/api/users
```

## HTTP 状态码

`HttpStatusInterceptor` 自动把 POST 的默认 201 改成 200。**所有成功请求统一 200**。失败状态码按语义返回（400 / 401 / 403 / 404 / 409 / 429 / 500）。

## DTO 校验（CRITICAL）

`main.ts` 已配置 `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`：
- 自动剥离 DTO 未定义字段
- 包含未知字段直接 400 拒绝

所有写接口必须有 DTO + class-validator 装饰器：

```ts
export class CreateEmployeeDto {
  @IsString() @MinLength(3) @MaxLength(50)
  username!: string;

  @IsString() @MinLength(8) @MaxLength(64)
  password!: string;

  @IsIn(['owner', 'manager', 'cashier', 'waiter'])
  role!: Role;
}
```

## 响应格式

后端响应**没有信封模式包装**。直接返回业务对象或 `{ data: ... }`：

```ts
// 列表
return { data: [...], total: 100 }

// 单实体
return { data: { id: 1, name: 'xxx' } }

// 简单消息
return { message: '删除成功' }
```

错误统一由 `AllExceptionsFilter` 处理：

```json
{ "statusCode": 400, "code": "RANGE_INVALID", "message": "...", "data": null }
```

## merchant-ops 模块的特殊规范

mop 模块（`src/modules/merchant-ops/`）有 **78+ 条产品需求 + 25 条不变量 + 25 个 PBT**，详见 `.kiro/specs/merchant-ops-center/`。开发时必读：

1. **Core 是纯类**：不 inject Repo 实现类，只 inject `RepoPort` 接口；通过 stub 注入做 PBT
2. **审计 / 通知 / 打印 / 导出 失败必须吞错**：不冒泡到订单主流程（红线）
3. **新 WebSocket 事件必须 `mop:` 前缀**：通过 `MopEventBus` 发出（运行期 + 类型层双重约束）
4. **既有表只能 `ADD COLUMN`**：不改列类型 / 名称
5. **写接口挂 `@Audit('XXX_ACTION')`**：审计自动写入 audit_logs

## PBT 测试约定

```ts
// 文件名：xxx.property.spec.ts
// 描述：'Feature: merchant-ops-center, Property N: <title>'
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

describe('Feature: merchant-ops-center, Property 17: ESC/POS round-trip', () => {
  it('parseEscPosFields(renderEscPos(t, p)) ⊇ Set(t.fields_json)', () => {
    fc.assert(fc.property(arbTemplate, (t) => { /* ... */ }), { numRuns: 200 });
  });
});
```

跑测试：`cd server && npm test`（vitest run，不带 watch）。

---

# 二、商家后台规范（admin-web/）

## 技术栈（写代码前确认）

- **React 18** + TypeScript + Vite 5
- **TailwindCSS 3**（vanilla，**不是** TailwindCSS 4，**不是** weapp-tailwindcss）
- **lucide-react**（**不是** lucide-react-taro）
- **axios**（**不是** Taro.request / Network）
- **zustand**（store）
- **react-router-dom v6**（PrivateRoute + RoleGuard）

**没有** `@/components/ui/*`、shadcn、Card 这种组件库。所有 UI 都是用 div + Tailwind 手搓。

## 文件别名

```ts
// vite.config.ts 配置
import request from '@/api/request'   // → admin-web/src/api/request
import Sidebar from '@/components/Sidebar'  // → admin-web/src/components/Sidebar
```

## 网络请求

**唯一入口**：`@/api/request`（axios 实例，已配置 baseURL + Authorization 拦截器）。

```ts
import request from '@/api/request'

// GET（注意 axios 拦截器已 unwrap response.data）
const data = await request.get('/users')

// POST
const result = await request.post('/users', { username, password })

// 带 query params
const list = await request.get('/orders', { params: { page: 1, status: 'submitted' } })

// 上传（FormData）
const formData = new FormData()
formData.append('file', file)
await request.post('/upload/image', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
```

**禁止**：
- `fetch('http://localhost:3000/api/...')` — 硬编码地址
- 自己 `axios.create(...)` — 不要绕开统一拦截器
- 直接读 `response.data.data` — 已被拦截器 unwrap 一层

**响应解包**：`request.interceptors.response.use((response) => response.data)` 已自动剥一层 axios 包装。**业务数据通常是 `{ data: ... }` 形式**，需要再 `.data` 一次或解构：

```ts
const res: any = await request.get('/merchant-ops/employees')
const list = res?.data ?? res     // 兼容两种返回（直接数组 / { data: [...] }）
```

## URL 约定

```ts
// ✅ 正确：相对路径，dev 走 vite proxy → :3000，prod 走环境变量 VITE_API_BASE_URL
await request.get('/orders')           // → /api/orders
await request.post('/auth/login', dto)

// ❌ 错误
await fetch('http://localhost:3000/api/orders')   // 硬编码
await request.get('/api/orders')                   // 路径里又写 /api，变成 /api/api/orders
```

`baseURL` 默认是 `/api`，所以业务代码 url **不写 `/api/` 前缀**，直接 `/orders` 即可。

## 样式

```tsx
// ✅ 正确：vanilla TailwindCSS 3 类名
<div className="bg-white rounded-xl shadow-sm border border-[#E2E8F0] p-5">
  <button className="px-3 py-2 rounded-lg bg-[#2563EB] text-white text-sm font-medium hover:bg-[#1D4ED8]">
    保存
  </button>
</div>

// ⚠️ 注意：项目有大量带 # 的硬编码颜色（如 #2563EB），这是既有惯例，新代码可以保留
// 后续若做主题化可以抽到 CSS variable，但本次不要批量改

// ❌ 不要引入不存在的组件库
import { Button } from '@/components/ui/button'  // 这个目录在 admin-web 不存在
```

## 图标

```tsx
// ✅ 正确
import { Save, Trash2, Loader2, Plus } from 'lucide-react'

<Save className="w-4 h-4" />
<Loader2 className="w-4 h-4 animate-spin" />
<Trash2 size={16} />

// ❌ 错误
import { Save } from 'lucide-react-taro'  // 这是 Taro 时代的，已不用
```

`lucide-react` 在 admin-web 是 React 组件，`className` 直接控制 stroke / fill 完全没问题（不像 Taro 版有 SVG 编码限制）。

## RBAC 权限守卫

业务页 + Sidebar 显隐由 `@/rbac/types.ts` 的 `PERMISSION_MATRIX` 控制；路由级守卫用 `<RoleGuard requiredRoles={[...]}>`：

```tsx
<Route path="employees" element={
  <RoleGuard requiredRoles={['owner', 'admin']}>
    <EmployeeManage />
  </RoleGuard>
} />
```

被禁角色直接 `<Forbidden />`。

---

# 三、微信小程序规范（xiaochengxu/）

## 技术栈（CRITICAL）

**纯微信原生小程序**：
- `.wxml` 模板（不是 JSX、不是 Vue template）
- `.wxss` 样式（不是 TailwindCSS）
- `.js` 逻辑（不是 TypeScript）
- `app.json` / `pages/<page>/<page>.json` 配置

**没有 React、没有 Taro、没有 H5、没有 Webpack/Vite**。

## TabBar

`app.json` 用 `"custom": true` 启用自定义 TabBar，组件位于 `xiaochengxu/custom-tab-bar/`。

底部三项：浏览（home/order）、订单（logs）、我的（me）。

## 网络请求

**唯一入口**：`utils/request.js` 暴露的 `request()` 函数（封装 `wx.request`）。

```js
const { request } = require('../../utils/request')
const config = require('../../config')

// GET（默认不显示 loading 蒙层）
const data = await request({ url: '/orders/my-active' })

// POST（显式开启 loading）
const result = await request({
  url: '/orders',
  method: 'POST',
  data: { tableId, items },
  loading: true,
  loadingTitle: '提交订单中...'
})

// 不需要 loading 的接口（绝大多数都是这种）
await request({ url: '/dishes', noLoading: true })
```

URL 拼接：`request.js` 内部用 `config.baseURL` 自动加前缀。`baseURL = config.SERVER_URL + '/api'`。

**SERVER_URL 切换**（`xiaochengxu/config.js`）：
- `LOCAL` — `http://localhost:3000`（仅微信开发者工具，需关闭"校验合法域名"）
- `TUNNEL` — cpolar/natapp 内网穿透 https 地址（开发版/体验版用，参考 `内网穿透配置指南.md`）
- `PROD` — `https://www.ali88.online`

**禁止**：
- `wx.request({ url: 'http://localhost:3000/...' })` — 直接调 wx.request 绕过封装
- 在业务代码里硬编码 URL — 走 `config` 模块

## 图片资源

- **TabBar 图标**：放 `xiaochengxu/images/tabbar/`（微信小程序硬要求本地 PNG）
- **菜品 / 店铺头像 / 桌台二维码**：后端 `multer + /uploads/` 存储，URL 通过 API 返回，小程序拼 `SERVER_URL + url` 显示

```js
// ✅ 拼接相对 URL
const dishImage = dish.image_url.startsWith('http')
  ? dish.image_url
  : SERVER_URL + (dish.image_url.startsWith('/') ? '' : '/') + dish.image_url

// ❌ 不要在小程序代码里 import 大图（包体积超限）
```

注：项目"应该"用 TOS 但**实际还没切**，当前用本地 multer。等切到 TOS 后这块要改。

## 平台检测（不需要）

xiaochengxu 是**纯小程序**，没有 H5 端，**不需要任何平台检测代码**。看到 `Taro.getEnv()` 这种是误导。

---

# 四、跨端通用约定

## 数据库迁移

所有迁移按编号顺序在 `server/drizzle/` 下：`0001_init.sql` → `0010_merchant_ops_m6_cleanup.sql` ...

迁移必须是 **idempotent 的**（重跑无副作用）：
- `CREATE TABLE IF NOT EXISTS`
- `INSERT ... ON DUPLICATE KEY UPDATE`
- 索引内联到 `CREATE TABLE` 里（避免重复 `CREATE INDEX` 报 1061）

执行（Windows）：
```bash
$env:MYSQL_PWD='xxx'; mysql -uroot --default-character-set=utf8mb4 scanfood -e "source drizzle/0010_xxx.sql"
```

## 资源清理（防止孤儿）

删除菜品 / 桌台 / 员工 / 店铺头像替换时，**业务代码必须清理对应的本地文件**。已封装为 `LocalImageCleanupService`（在 `CommonModule`，全局可用）：

```ts
// 在 service 注入
constructor(private readonly imageCleanup: LocalImageCleanupService) {}

// fire-and-forget（不阻塞主删除流程）
async deleteDish(id: number) {
  const cur = await db.select({ image_url: dishes.image_url }).from(dishes).where(eq(dishes.id, id)).limit(1)
  await db.delete(dishes).where(eq(dishes.id, id))
  if (cur[0]?.image_url) {
    void this.imageCleanup.removeByUrl(cur[0].image_url)  // 自动跳过外部 URL
  }
}
```

`removeByUrl()` 已做路径白名单：仅清理 `/uploads/` 下的文件，外部 URL（http(s)://...）和路径穿越自动拒绝（Property 24/25 PBT 验证）。

## 错误处理

- 业务异常 throw `BadRequestException({ code: 'XXX_ERROR', msg: '...' })`
- 跨切关注点（审计 / 打印 / 通知）异常**必须 try/catch 吞掉**，不能影响主流程
- 永远不要在 controller 里 try/catch 然后 return 业务错误对象（让 `AllExceptionsFilter` 统一处理）

## 安全红线（绝不破坏）

来自 spec 的不可改条款：
- ✅ 既有共享购物车 / WS 订阅 / 订单锁定 / 桌号释放机制
- ✅ `users` / `orders` / `cart_items` 表只能 `ADD COLUMN`，不改原列
- ✅ 既有 WebSocket 事件名 + payload 不动；新事件必须 `mop:` 前缀
- ✅ `OrdersGateway.notifyAllAdmins` / `OrdersService` 方法签名不动
- ✅ AES_KEY / FEIE_USER / FEIE_UKEY 等密钥从 `.env` 注入，**禁止硬编码**

---

# 五、AI 协作规则

## 改动前必读

1. 这份 AGENTS.md
2. 涉及 mop 模块时还要读 `.kiro/specs/merchant-ops-center/{requirements,design}.md`
3. README.md（项目结构与启动）
4. DEPS_HEALTH.md（依赖版本治理记录）

## 改动后必做

1. 跑 `cd server && npm test` 确认 PBT 全过
2. 跑 `cd server && npm run build` 确认 nest build
3. 跑 `cd admin-web && npx tsc --noEmit` 确认类型
4. commit 用 commitlint 规范

## 包管理操作

```bash
# server/admin-web 装新包：单独 cd 进去
cd server && npm install <pkg>
cd admin-web && npm install <pkg>

# 不要在根目录 npm install / pnpm install（根目录无依赖）
# 不要装 pnpm（项目不用 pnpm 了）
```

## 平台环境

Windows + cmd / PowerShell + Node 20。命令提示：
- 用 `;` 不用 `&&`（PowerShell 不支持后者）
- 重定向用 `2>&1` 但 PowerShell 把 stderr 当错误，可能误报；优先看 exit code
- 中文路径用 utf-8（mysql 命令加 `--default-character-set=utf8mb4`）

## 不要做的事

- ❌ 引入 Taro / pnpm / shadcn-ui / weapp-tailwindcss / lucide-react-taro 这种已死技术
- ❌ 在根目录添加依赖（根 package.json 是 meta，0 依赖）
- ❌ 跳过 `LocalImageCleanupService` 直接 `fs.unlink`（要走白名单防穿越）
- ❌ 在 mop core 里 inject `OrdersService`（DI-7 红线，只能通过 RepoPort 投影读）
- ❌ 改既有列类型 / 名称（红线）
- ❌ 把密钥写进代码或测试文件（用 env）

如果有疑惑：**先看代码，不看历史文档**。本项目历史包袱多，文档可能过时，代码是唯一真相源。
