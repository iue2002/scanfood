# 扫码点餐项目

一个三端协同的餐饮 SaaS 项目：**微信小程序顾客端 + 商家后台管理 + NestJS 后端 API**。

## 项目结构

```
projects/
├── xiaochengxu/        # 微信小程序原生（顾客端：扫码点餐 / 加菜 / 结账）
├── admin-web/          # 商家后台 (Vite + React + TailwindCSS)
├── server/             # NestJS 后端 (Drizzle ORM + MySQL + WebSocket)
├── .kiro/specs/        # 产品规格文档（merchant-ops-center 等）
├── .gitignore
├── .nvmrc              # Node 20
├── .npmrc              # npm 镜像与重试配置
├── package.json        # 项目集合 meta（不安装任何依赖）
├── DEPS_HEALTH.md      # 依赖健康度文档
└── README.md           # 本文件
```

## 技术栈

| 子项目 | 技术栈 | 包管理 |
|---|---|---|
| `xiaochengxu/` | 微信小程序原生 (wxml + wxss + js) | 无 |
| `admin-web/` | React 18 + Vite 5 + TailwindCSS 3 + Zustand + axios | npm |
| `server/` | NestJS 10 + Drizzle ORM 0.45 + MySQL 8 + Express 4 + ws | npm |

后端关键能力：JWT 认证、RBAC 权限矩阵、审计日志、通知偏好、Excel/PDF 导出、云打印（飞鹅+浏览器）。

## 环境要求

- **Node.js**：>= 20.0.0 < 23.0.0（项目根目录有 `.nvmrc=20`）
- **npm**：>= 10
- **MySQL**：8.0+

## 快速开始

### 1. Node 版本

```bash
nvm use   # 自动读取 .nvmrc
node --version  # 应该是 v20.x
```

### 2. 启动后端

```bash
cd server
cp .env.example .env  # 如果存在；或编辑 .env 配置 DB_*、AES_KEY 等
npm install
npm run dev           # nest start --watch，监听 :3000
```

### 3. 启动商家后台

```bash
cd admin-web
npm install
npm run dev           # vite dev server，监听 :5173
```

商家后台默认账号：`admin / admin123`（首次启动后请立即改密）

### 4. 微信小程序

用微信开发者工具打开 `xiaochengxu/` 目录，配置好 AppID 即可。

## 数据库迁移

```bash
cd server
mysql -uroot scanfood < drizzle/0001_init.sql
mysql -uroot scanfood < drizzle/0002_users_columns.sql
# ... 按编号顺序跑完所有迁移
```

## 测试

```bash
cd server
npm test              # vitest run，跑全量 PBT（含 fast-check 属性测试）
```

## 安全回滚

```bash
git tag --list "backup*"
git reset --hard backup-before-deps-cleanup     # 依赖治理前
git reset --hard backup-before-root-cleanup     # 根目录治理前
```

## 历史记录

本项目早期是 Taro 4 H5+小程序架构，后期改为微信小程序原生 + admin-web 独立。
原 Taro 配置在 commit `5001c90` 之后逐步移除。当前 Taro 相关死代码（src/, config/, types/, patches/, babel.config.js, tsconfig.json, eslint.config.mjs, stylelint.config.mjs, pnpm-workspace.yaml）已全部清理。

## 文档

- `DEPS_HEALTH.md` - 依赖治理记录
- `AGENTS.md` - AI 协作开发规范（小程序端样式 / 网络请求 / 组件库 / 跨端兼容性等）
- `内网穿透配置指南.md` - 微信小程序开发期访问后端 API 的 cpolar / natapp / ngrok 方案
- `.kiro/specs/merchant-ops-center/` - 商家运营中心产品规格

## HTTPS 开发证书（admin-web）

如果需要 admin-web 用 HTTPS（PWA 测试 / 微信开发者工具调用 web-view），用 `mkcert` 生成本地 CA：

```bash
choco install mkcert     # 或 scoop install mkcert
mkcert -install
cd admin-web
mkcert localhost 127.0.0.1 ::1   # 生成 localhost+2.pem 和 localhost+2-key.pem
npm run dev                       # vite 自动检测启用 HTTPS
```
