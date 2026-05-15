-- 扫码点餐系统数据库初始化脚本
-- 在 MySQL 中执行：source /path/to/init.sql

CREATE DATABASE IF NOT EXISTS scanfood DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE scanfood;

-- 系统健康检查表
CREATE TABLE IF NOT EXISTS health_check (
  id INT AUTO_INCREMENT PRIMARY KEY,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'customer',
  openid VARCHAR(100),
  nickname VARCHAR(100),
  avatar_url VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  INDEX users_username_idx (username),
  INDEX users_role_idx (role),
  INDEX users_openid_idx (openid)
);

-- 桌台表
CREATE TABLE IF NOT EXISTS tables (
  id INT AUTO_INCREMENT PRIMARY KEY,
  table_number VARCHAR(20) NOT NULL UNIQUE,
  capacity INT NOT NULL DEFAULT 4,
  status VARCHAR(20) NOT NULL DEFAULT 'idle',
  qr_code_url VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  INDEX tables_table_number_idx (table_number),
  INDEX tables_status_idx (status)
);

-- 菜品分类表
CREATE TABLE IF NOT EXISTS dish_categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  INDEX dish_categories_sort_order_idx (sort_order)
);

-- 菜品表
CREATE TABLE IF NOT EXISTS dishes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  category_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  description VARCHAR(500),
  image_url VARCHAR(500),
  price DECIMAL(10, 2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'available',
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  INDEX dishes_category_id_idx (category_id),
  INDEX dishes_status_idx (status),
  INDEX dishes_sort_order_idx (sort_order),
  FOREIGN KEY (category_id) REFERENCES dish_categories(id)
);

-- 菜品规格表
CREATE TABLE IF NOT EXISTS dish_specs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  dish_id INT NOT NULL,
  spec_name VARCHAR(20) NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  INDEX dish_specs_dish_id_idx (dish_id),
  FOREIGN KEY (dish_id) REFERENCES dishes(id) ON DELETE CASCADE
);

-- 订单表
CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  table_id INT NOT NULL,
  order_number VARCHAR(50) NOT NULL UNIQUE,
  total_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'submitted',
  user_id INT,
  remark VARCHAR(500),
  printed_at TIMESTAMP NULL,
  settled_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  INDEX orders_table_id_idx (table_id),
  INDEX orders_order_number_idx (order_number),
  INDEX orders_status_idx (status),
  INDEX orders_user_id_idx (user_id),
  INDEX orders_created_at_idx (created_at),
  FOREIGN KEY (table_id) REFERENCES tables(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 订单明细表
CREATE TABLE IF NOT EXISTS order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  dish_id INT NOT NULL,
  spec_id INT,
  dish_name VARCHAR(100) NOT NULL,
  spec_name VARCHAR(20),
  quantity INT NOT NULL DEFAULT 1,
  price DECIMAL(10, 2) NOT NULL,
  subtotal DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  INDEX order_items_order_id_idx (order_id),
  INDEX order_items_dish_id_idx (dish_id),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (dish_id) REFERENCES dishes(id),
  FOREIGN KEY (spec_id) REFERENCES dish_specs(id)
);

-- 小票打印记录表
CREATE TABLE IF NOT EXISTS print_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  error_message VARCHAR(500),
  printed_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  INDEX print_records_order_id_idx (order_id),
  INDEX print_records_status_idx (status),
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

-- 退款/售后记录表
CREATE TABLE IF NOT EXISTS refunds (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  operator_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  INDEX refunds_order_id_idx (order_id),
  INDEX refunds_status_idx (status),
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (operator_id) REFERENCES users(id)
);

-- 插入默认管理员账号（密码: admin123，bcrypt hash）
INSERT IGNORE INTO users (username, password, role, nickname) VALUES
('admin', '$2a$10$N9qo8uLOickgx2ZMRZoMy.MqrqPzVvRNC1JzN7.7Qf6XvQvQvQvQv', 'admin', '系统管理员');

INSERT IGNORE INTO users (username, password, role, nickname) VALUES
('staff', '$2a$10$N9qo8uLOickgx2ZMRZoMy.MqrqPzVvRNC1JzN7.7Qf6XvQvQvQvQv', 'staff', '前台员工');
