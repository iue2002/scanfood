-- =====================================================
-- 单门店桌码点餐系统 - 数据库初始化脚本
-- 执行方式：在 Supabase SQL Editor 中运行此脚本
-- =====================================================

-- 1. 启用 UUID 扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- 2. 创建数据表
-- =====================================================

-- 2.1 用户表
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'customer', -- customer/admin/staff
  openid VARCHAR(100), -- 微信openid
  nickname VARCHAR(100),
  avatar_url VARCHAR(500),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS users_username_idx ON users(username);
CREATE INDEX IF NOT EXISTS users_role_idx ON users(role);
CREATE INDEX IF NOT EXISTS users_openid_idx ON users(openid);

-- 2.2 桌台表
CREATE TABLE IF NOT EXISTS tables (
  id SERIAL PRIMARY KEY,
  table_number VARCHAR(20) NOT NULL UNIQUE, -- 桌台编号：A1, B2等
  capacity INTEGER NOT NULL DEFAULT 4, -- 容纳人数
  status VARCHAR(20) NOT NULL DEFAULT 'idle', -- idle/occupied/settled
  qr_code_url VARCHAR(500), -- 二维码图片URL
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS tables_table_number_idx ON tables(table_number);
CREATE INDEX IF NOT EXISTS tables_status_idx ON tables(status);

-- 2.3 菜品分类表
CREATE TABLE IF NOT EXISTS dish_categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0, -- 排序
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS dish_categories_sort_order_idx ON dish_categories(sort_order);

-- 2.4 菜品表
CREATE TABLE IF NOT EXISTS dishes (
  id SERIAL PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES dish_categories(id),
  name VARCHAR(100) NOT NULL,
  description VARCHAR(500),
  image_url VARCHAR(500),
  price NUMERIC(10, 2) NOT NULL, -- 基础价格
  status VARCHAR(20) NOT NULL DEFAULT 'available', -- available/unavailable
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS dishes_category_id_idx ON dishes(category_id);
CREATE INDEX IF NOT EXISTS dishes_status_idx ON dishes(status);
CREATE INDEX IF NOT EXISTS dishes_sort_order_idx ON dishes(sort_order);

-- 2.5 菜品规格表
CREATE TABLE IF NOT EXISTS dish_specs (
  id SERIAL PRIMARY KEY,
  dish_id INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  spec_name VARCHAR(20) NOT NULL, -- 大份/中份/小份
  price NUMERIC(10, 2) NOT NULL, -- 该规格价格
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS dish_specs_dish_id_idx ON dish_specs(dish_id);

-- 2.6 订单表
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  table_id INTEGER NOT NULL REFERENCES tables(id),
  order_number VARCHAR(50) NOT NULL UNIQUE, -- 订单号
  total_amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'submitted', -- submitted/printed/settled/cancelled/refunded
  user_id INTEGER REFERENCES users(id), -- 下单用户（可为空，支持游客点餐）
  remark VARCHAR(500), -- 备注
  printed_at TIMESTAMP WITH TIME ZONE, -- 打印时间
  settled_at TIMESTAMP WITH TIME ZONE, -- 结账时间
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS orders_table_id_idx ON orders(table_id);
CREATE INDEX IF NOT EXISTS orders_order_number_idx ON orders(order_number);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status);
CREATE INDEX IF NOT EXISTS orders_user_id_idx ON orders(user_id);
CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders(created_at);

-- 2.7 订单明细表
CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  dish_id INTEGER NOT NULL REFERENCES dishes(id),
  spec_id INTEGER REFERENCES dish_specs(id), -- 规格ID（可为空）
  dish_name VARCHAR(100) NOT NULL, -- 冗余存储，防止菜品删除后无法查看
  spec_name VARCHAR(20), -- 规格名称
  quantity INTEGER NOT NULL DEFAULT 1,
  price NUMERIC(10, 2) NOT NULL, -- 单价
  subtotal NUMERIC(10, 2) NOT NULL, -- 小计 = price * quantity
  added_by_user_id INTEGER REFERENCES users(id), -- 添加菜品的用户ID
  added_by_nickname VARCHAR(100), -- 添加菜品的用户昵称
  phase VARCHAR(20) NOT NULL DEFAULT 'order', -- order=首次点餐, add_more=加餐
  add_more_round INTEGER NOT NULL DEFAULT 0, -- 加餐轮次：0=首次点餐, 1=第1次加餐...
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON order_items(order_id);
CREATE INDEX IF NOT EXISTS order_items_dish_id_idx ON order_items(dish_id);
CREATE INDEX IF NOT EXISTS order_items_added_by_user_id_idx ON order_items(added_by_user_id);

-- 2.8 小票打印记录表
CREATE TABLE IF NOT EXISTS print_records (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  printed_by INTEGER REFERENCES users(id), -- 打印人
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS print_records_order_id_idx ON print_records(order_id);

-- 2.9 退款记录表
CREATE TABLE IF NOT EXISTS refunds (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  amount NUMERIC(10, 2) NOT NULL,
  reason VARCHAR(500),
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending/approved/rejected
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS refunds_order_id_idx ON refunds(order_id);
CREATE INDEX IF NOT EXISTS refunds_status_idx ON refunds(status);

-- =====================================================
-- 3. 插入初始数据
-- =====================================================

-- 3.1 插入管理员和前台账号
-- 密码使用 bcryptjs 加密，salt rounds = 10
-- admin 账号密码: admin123
-- staff 账号密码: staff123

INSERT INTO users (username, password, role, nickname) VALUES
('admin', '$2b$10$5ougYh17lPV0CrWwzcg47uPdrlEJuW4cllpC0MJljDfOyPEGh43j6', 'admin', '管理员'),
('staff', '$2b$10$Ijit2FfFUhrh/QdZT/4iCu/dSruH/imGgDdSFfKTvaloQ9JfpLonm', 'staff', '前台接待')
ON CONFLICT (username) DO NOTHING;

-- 3.2 插入菜品分类
INSERT INTO dish_categories (name, sort_order) VALUES
('热菜', 1),
('凉菜', 2),
('主食', 3),
('饮品', 4),
('甜点', 5)
ON CONFLICT DO NOTHING;

-- 3.3 插入示例菜品
INSERT INTO dishes (category_id, name, description, price, status, sort_order) VALUES
-- 热菜
(1, '红烧肉', '经典家常菜，肥而不腻', 48.00, 'available', 1),
(1, '糖醋排骨', '酸甜可口，老少皆宜', 52.00, 'available', 2),
(1, '清蒸鲈鱼', '新鲜鲈鱼清蒸，鲜嫩可口', 68.00, 'available', 3),
(1, '宫保鸡丁', '经典川菜，麻辣鲜香', 38.00, 'available', 4),
(1, '麻婆豆腐', '麻辣鲜香，下饭神器', 28.00, 'available', 5),

-- 凉菜
(2, '凉拌黄瓜', '爽脆可口，开胃解腻', 18.00, 'available', 1),
(2, '口水鸡', '麻辣鲜香，川味凉菜', 36.00, 'available', 2),
(2, '皮蛋豆腐', '经典凉菜，清爽解暑', 22.00, 'available', 3),

-- 主食
(3, '米饭', '精选东北大米', 3.00, 'available', 1),
(3, '蛋炒饭', '粒粒分明，金黄诱人', 18.00, 'available', 2),
(3, '担担面', '四川特色面食', 22.00, 'available', 3),

-- 饮品
(4, '可乐', '冰镇可口可乐', 8.00, 'available', 1),
(4, '鲜榨橙汁', '新鲜橙子现榨', 18.00, 'available', 2),
(4, '酸梅汤', '解暑神器', 12.00, 'available', 3),

-- 甜点
(5, '芒果布丁', '香甜软糯', 16.00, 'available', 1),
(5, '双皮奶', '广东经典甜品', 14.00, 'available', 2)
ON CONFLICT DO NOTHING;

-- 3.4 插入菜品规格（为部分菜品添加大中小份）
-- 红烧肉
INSERT INTO dish_specs (dish_id, spec_name, price) VALUES
(1, '小份', 38.00),
(1, '中份', 48.00),
(1, '大份', 68.00),
-- 糖醋排骨
(2, '小份', 42.00),
(2, '中份', 52.00),
(2, '大份', 72.00),
-- 清蒸鲈鱼
(3, '一斤', 68.00),
(3, '一斤半', 98.00),
(3, '两斤', 128.00)
ON CONFLICT DO NOTHING;

-- 3.5 插入桌台
INSERT INTO tables (table_number, capacity, status) VALUES
-- A区（大厅）
('A1', 4, 'idle'),
('A2', 4, 'idle'),
('A3', 6, 'idle'),
('A4', 6, 'idle'),
('A5', 8, 'idle'),
-- B区（包间）
('B1', 8, 'idle'),
('B2', 10, 'idle'),
('B3', 12, 'idle'),
-- C区（卡座）
('C1', 2, 'idle'),
('C2', 2, 'idle'),
('C3', 4, 'idle'),
('C4', 4, 'idle')
ON CONFLICT (table_number) DO NOTHING;

-- =====================================================
-- 4. 创建更新时间触发器
-- =====================================================

-- 创建更新时间函数
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 为各表添加触发器
DO $$
DECLARE
    t text;
BEGIN
    FOR t IN SELECT unnest(ARRAY['users', 'tables', 'dish_categories', 'dishes', 'orders', 'refunds'])
    LOOP
        EXECUTE format('
            DROP TRIGGER IF EXISTS update_%s_updated_at ON %s;
            CREATE TRIGGER update_%s_updated_at
                BEFORE UPDATE ON %s
                FOR EACH ROW
                EXECUTE FUNCTION update_updated_at_column();
        ', t, t, t, t);
    END LOOP;
END;
$$;

-- =====================================================
-- 5. 启用行级安全策略（RLS）
-- =====================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE dish_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE dishes ENABLE ROW LEVEL SECURITY;
ALTER TABLE dish_specs ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE print_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;

-- 为所有表创建"允许所有操作"的策略（service_role可绕过）
-- 实际生产环境应根据需求配置更细粒度的策略

CREATE POLICY "Allow all for service_role" ON users FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Allow all for service_role" ON tables FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Allow all for service_role" ON dish_categories FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Allow all for service_role" ON dishes FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Allow all for service_role" ON dish_specs FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Allow all for service_role" ON orders FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Allow all for service_role" ON order_items FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Allow all for service_role" ON print_records FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Allow all for service_role" ON refunds FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- 公开读取策略（菜品、分类、桌台信息允许匿名读取）
CREATE POLICY "Allow anonymous read" ON dish_categories FOR SELECT USING (true);
CREATE POLICY "Allow anonymous read" ON dishes FOR SELECT USING (true);
CREATE POLICY "Allow anonymous read" ON dish_specs FOR SELECT USING (true);
CREATE POLICY "Allow anonymous read" ON tables FOR SELECT USING (true);

-- =====================================================
-- 完成！
-- =====================================================

-- 输出初始化结果
DO $$
DECLARE
    user_count INTEGER;
    dish_count INTEGER;
    table_count INTEGER;
    category_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO user_count FROM users;
    SELECT COUNT(*) INTO dish_count FROM dishes;
    SELECT COUNT(*) INTO table_count FROM tables;
    SELECT COUNT(*) INTO category_count FROM dish_categories;
    
    RAISE NOTICE '========================================';
    RAISE NOTICE '数据库初始化完成！';
    RAISE NOTICE '========================================';
    RAISE NOTICE '用户数量：% (管理员: admin/admin123, 前台: staff/staff123)', user_count;
    RAISE NOTICE '菜品分类：% 个', category_count;
    RAISE NOTICE '菜品数量：% 道', dish_count;
    RAISE NOTICE '桌台数量：% 张', table_count;
    RAISE NOTICE '========================================';
END;
$$;
