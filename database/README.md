# 数据库初始化说明

## 📋 概述

本目录包含单门店桌码点餐系统的数据库初始化脚本，可以一键创建所有数据表和初始数据。

## 🚀 快速开始

### 方式一：Supabase Dashboard 执行（推荐）

1. 登录 [Supabase Dashboard](https://supabase.com/dashboard)
2. 选择你的项目
3. 点击左侧菜单 **SQL Editor**
4. 点击 **New Query**
5. 复制 `init.sql` 的全部内容并粘贴
6. 点击 **Run** 执行

### 方式二：使用 Supabase CLI

```bash
# 确保已安装 Supabase CLI
npm install -g supabase

# 登录
supabase login

# 执行 SQL 文件
supabase db execute --file ./database/init.sql --project-ref <your-project-ref>
```

### 方式三：使用 psql 命令行

```bash
# 获取数据库连接字符串（从 Supabase Dashboard > Settings > Database）
psql "<your-connection-string>" -f ./database/init.sql
```

## 📊 初始化数据

执行成功后将创建以下数据：

### 用户账号

| 用户名 | 密码 | 角色 | 说明 |
|--------|------|------|------|
| admin | admin123 | admin | 管理员，拥有所有权限 |
| staff | staff123 | staff | 前台，可管理订单和桌台 |

### 菜品分类

- 热菜
- 凉菜
- 主食
- 饮品
- 甜点

### 示例菜品

- **热菜**：红烧肉、糖醋排骨、清蒸鲈鱼、宫保鸡丁、麻婆豆腐
- **凉菜**：凉拌黄瓜、口水鸡、皮蛋豆腐
- **主食**：米饭、蛋炒饭、担担面
- **饮品**：可乐、鲜榨橙汁、酸梅汤
- **甜点**：芒果布丁、双皮奶

部分菜品已配置规格（大份/中份/小份或一斤/一斤半/两斤）。

### 桌台

| 区域 | 桌台编号 | 容纳人数 |
|------|----------|----------|
| A区（大厅） | A1-A5 | 4-8人 |
| B区（包间） | B1-B3 | 8-12人 |
| C区（卡座） | C1-C4 | 2-4人 |

## 📁 数据表结构

```
┌─────────────────────────────────────────────────────────────┐
│                        users (用户表)                        │
│  id, username, password, role, openid, nickname, avatar_url │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ user_id
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                       orders (订单表)                        │
│  id, table_id, order_number, total_amount, status, remark   │
└─────────────────────────────────────────────────────────────┘
         │                                    │
         │ table_id                           │ order_id
         ▼                                    ▼
┌──────────────────────┐        ┌──────────────────────────────┐
│   tables (桌台表)    │        │   order_items (订单明细表)   │
│ id, table_number,    │        │  id, dish_id, quantity,      │
│ capacity, status     │        │  price, subtotal             │
└──────────────────────┘        └──────────────────────────────┘
                                           │
                                           │ dish_id
                                           ▼
┌─────────────────────────────────────────────────────────────┐
│                       dishes (菜品表)                        │
│  id, category_id, name, description, price, status          │
└─────────────────────────────────────────────────────────────┘
         │                                    │
         │ category_id                        │ dish_id
         ▼                                    ▼
┌──────────────────────┐        ┌──────────────────────────────┐
│ dish_categories      │        │   dish_specs (规格表)        │
│   (分类表)           │        │  id, spec_name, price        │
└──────────────────────┘        └──────────────────────────────┘
```

## 🔐 安全策略

脚本已自动配置以下行级安全策略（RLS）：

1. **菜品/分类/桌台**：允许匿名读取（顾客可浏览）
2. **订单/用户**：仅 service_role 可操作（通过后端 API）
3. 所有表均已启用 RLS

## ⚠️ 注意事项

1. **重复执行安全**：脚本使用 `ON CONFLICT DO NOTHING`，重复执行不会产生重复数据
2. **密码安全**：生产环境请立即修改默认密码
3. **数据清理**：如需重新初始化，请先删除所有表后再执行

## 🔧 常用操作

### 重置数据库

```sql
-- ⚠️ 危险操作：删除所有数据
DROP TABLE IF EXISTS refunds CASCADE;
DROP TABLE IF EXISTS print_records CASCADE;
DROP TABLE IF EXISTS order_items CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS dish_specs CASCADE;
DROP TABLE IF EXISTS dishes CASCADE;
DROP TABLE IF EXISTS dish_categories CASCADE;
DROP TABLE IF EXISTS tables CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- 然后重新执行 init.sql
```

### 查看初始化结果

```sql
-- 查看用户
SELECT id, username, role, nickname FROM users;

-- 查看菜品统计
SELECT c.name as category, COUNT(d.id) as dish_count
FROM dish_categories c
LEFT JOIN dishes d ON c.id = d.category_id
GROUP BY c.id, c.name;

-- 查看桌台
SELECT table_number, capacity, status FROM tables ORDER BY table_number;
```

## 📝 更新日志

- **v1.0** - 初始版本，包含完整的表结构和示例数据
