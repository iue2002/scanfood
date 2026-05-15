# 🍽️ 数据库快速初始化指南

## 一键初始化数据库

### 步骤 1：获取 Supabase 凭据

1. 登录 [Supabase Dashboard](https://supabase.com/dashboard)
2. 选择你的项目（或创建新项目）
3. 点击 **Settings** → **API**
4. 复制以下信息：
   - **Project URL**: `https://xxxx.supabase.co`
   - **Service Role Key**: `eyJhbGciOiJIUzI1NiIsInR5cCI6...`

### 步骤 2：配置环境变量

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑 .env 文件，填入你的凭据
# SUPABASE_URL=https://xxxx.supabase.co
# SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIs...
```

### 步骤 3：执行初始化

**方式 A：在 Supabase Dashboard 执行（推荐）**

1. 打开 Supabase Dashboard
2. 点击左侧 **SQL Editor**
3. 点击 **New Query**
4. 复制 `database/init.sql` 的全部内容
5. 点击 **Run** 执行

**方式 B：使用命令行检查**

```bash
# 检查数据库状态
pnpm db:check

# 如果表不存在，请先在 Dashboard 中执行 init.sql
```

### 步骤 4：验证初始化结果

```bash
pnpm db:check
```

预期输出：
```
📊 数据表状态：

  ✅ 用户     | 2 条记录
  ✅ 桌台     | 12 条记录
  ✅ 菜品分类 | 5 条记录
  ✅ 菜品     | 16 条记录
  ✅ 菜品规格 | 9 条记录
  ✅ 订单     | 0 条记录
  ✅ 订单明细 | 0 条记录
  ✅ 打印记录 | 0 条记录
  ✅ 退款记录 | 0 条记录

👤 用户列表：

  1. admin      | admin      | 管理员
  2. staff      | staff      | 前台接待
```

## 默认账号

| 用户名 | 密码 | 角色 | 权限说明 |
|--------|------|------|----------|
| admin | admin123 | admin | 管理员，拥有所有权限 |
| staff | staff123 | staff | 前台，可管理订单和桌台 |

⚠️ **安全提示**：生产环境请立即修改默认密码！

## 初始化数据说明

### 菜品分类（5个）
- 热菜、凉菜、主食、饮品、甜点

### 示例菜品（16道）
| 分类 | 菜品 |
|------|------|
| 热菜 | 红烧肉、糖醋排骨、清蒸鲈鱼、宫保鸡丁、麻婆豆腐 |
| 凉菜 | 凉拌黄瓜、口水鸡、皮蛋豆腐 |
| 主食 | 米饭、蛋炒饭、担担面 |
| 饮品 | 可乐、鲜榨橙汁、酸梅汤 |
| 甜点 | 芒果布丁、双皮奶 |

### 桌台配置（12张）
| 区域 | 桌号 | 容量 |
|------|------|------|
| A区（大厅） | A1-A5 | 4-8人 |
| B区（包间） | B1-B3 | 8-12人 |
| C区（卡座） | C1-C4 | 2-4人 |

## 常见问题

### Q: 执行 SQL 报错 "relation already exists"？
A: 正常现象，脚本使用 `IF NOT EXISTS`，重复执行不会出错。

### Q: 如何重置数据库？
A: 在 SQL Editor 中执行：
```sql
DROP TABLE IF EXISTS refunds CASCADE;
DROP TABLE IF EXISTS print_records CASCADE;
DROP TABLE IF EXISTS order_items CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS dish_specs CASCADE;
DROP TABLE IF EXISTS dishes CASCADE;
DROP TABLE IF EXISTS dish_categories CASCADE;
DROP TABLE IF EXISTS tables CASCADE;
DROP TABLE IF EXISTS users CASCADE;
```
然后重新执行 `init.sql`。

### Q: 如何修改默认密码？
A: 登录后通过用户管理页面修改，或在 SQL Editor 中：
```sql
-- 使用 Node.js 生成密码哈希
-- node -e "const bcrypt = require('bcryptjs'); console.log(bcrypt.hashSync('新密码', 10));"

-- 更新密码
UPDATE users SET password = '新的哈希值' WHERE username = 'admin';
```

## 下一步

数据库初始化完成后：

1. ✅ 启动开发服务：`pnpm dev`
2. ✅ 访问前端：http://localhost:5000
3. ✅ 使用 admin/admin123 登录后台管理
4. ✅ 扫码测试点餐流程
