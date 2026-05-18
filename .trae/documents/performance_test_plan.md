# 餐饮点餐系统性能测试方案

## 1. 测试概述

本测试方案针对餐饮点餐系统的**后端服务**和**小程序前端**进行全面性能测试，旨在评估系统在各种场景下的性能表现。

### 1.1 测试目标

| 目标类型 | 描述 |
|----------|------|
| **性能基准** | 建立系统性能基线，评估响应时间、吞吐量等关键指标 |
| **瓶颈识别** | 发现系统性能瓶颈和潜在问题 |
| **稳定性验证** | 验证系统在高负载下的稳定性 |
| **兼容性测试** | 验证小程序在不同设备和网络环境下的兼容性 |

### 1.2 测试范围

| 测试对象 | 测试内容 |
|----------|----------|
| **后端服务** | API响应时间、吞吐量、并发处理能力 |
| **小程序前端** | 页面加载速度、渲染性能、交互响应 |
| **网络通信** | 数据传输效率、错误率 |
| **设备适配** | 不同设备、屏幕尺寸、系统版本的兼容性 |

---

## 2. 后端性能测试方案

### 2.1 测试环境

| 项目 | 配置 |
|------|------|
| 服务器 | Node.js v22.16.0 |
| 数据库 | MySQL 8.0+ |
| 测试工具 | Artillery.io |
| 测试端口 | http://localhost:3000 |

### 2.2 测试指标

| 指标 | 定义 | 目标值 |
|------|------|--------|
| **平均响应时间** | 所有请求的平均响应时间 | < 500ms |
| **P95响应时间** | 95%请求的响应时间 | < 1000ms |
| **P99响应时间** | 99%请求的响应时间 | < 2000ms |
| **吞吐量** | 每秒处理的请求数 | > 100 req/s |
| **错误率** | 请求失败的比例 | < 1% |
| **CPU使用率** | 服务器CPU占用率 | < 70% |
| **内存使用率** | 服务器内存占用率 | < 80% |

### 2.3 测试场景

#### 场景1：高并发下单

```yaml
config:
  target: "http://localhost:3000"
  phases:
    - duration: 30
      arrivalRate: 20
      name: "预热阶段"
    - duration: 60
      arrivalRate: 50
      name: "持续负载"
    - duration: 60
      arrivalRate: 100
      name: "高负载"
    - duration: 30
      arrivalRate: 150
      name: "峰值负载"
  plugins:
    metrics-by-endpoint: {}
scenarios:
  - name: "创建订单流程"
    flow:
      - post:
          url: "/api/orders"
          headers:
            Authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
            Content-Type: "application/json"
          json:
            table_id: 1
            items:
              - dish_id: 4
                quantity: 2
                price: 5.0
                dish_name: "羊肉串"
```

#### 场景2：高频查询

```yaml
config:
  target: "http://localhost:3000"
  phases:
    - duration: 60
      arrivalRate: 100
      name: "查询负载"
  plugins:
    metrics-by-endpoint: {}
scenarios:
  - name: "菜品查询"
    flow:
      - get:
          url: "/api/dishes"
      - get:
          url: "/api/tables/board"
```

#### 场景3：混合负载

```yaml
config:
  target: "http://localhost:3000"
  phases:
    - duration: 120
      arrivalRate: 80
      name: "混合负载"
scenarios:
  - name: "下单流程"
    weight: 3
    flow:
      - post:
          url: "/api/orders/sync-draft"
          headers:
            Authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
          json:
            table_id: 1
            items:
              - dish_id: 4
                quantity: 1
                price: 5.0
                dish_name: "羊肉串"
  - name: "查询流程"
    weight: 5
    flow:
      - get:
          url: "/api/dishes/categories"
      - get:
          url: "/api/tables"
  - name: "订单查询"
    weight: 2
    flow:
      - get:
          url: "/api/orders?page=1&page_size=20"
```

### 2.4 测试用例

| 接口 | 方法 | 测试类型 | 预期结果 |
|------|------|----------|----------|
| `/api/dishes` | GET | 压力测试 | 响应时间 < 300ms |
| `/api/tables/board` | GET | 压力测试 | 响应时间 < 200ms |
| `/api/orders` | POST | 压力测试 | 响应时间 < 800ms |
| `/api/orders/sync-draft` | POST | 压力测试 | 响应时间 < 600ms |
| `/api/auth/login` | POST | 压力测试 | 响应时间 < 500ms |
| `/api/auth/me` | GET | 压力测试 | 响应时间 < 200ms |

---

## 3. 小程序性能测试方案

### 3.1 测试环境

| 项目 | 描述 |
|------|------|
| 测试平台 | 微信开发者工具、真机测试 |
| 网络环境 | 4G、Wi-Fi、弱网 |
| 设备类型 | iOS、Android、不同屏幕尺寸 |

### 3.2 测试指标

| 指标 | 定义 | 目标值 |
|------|------|--------|
| **首次加载时间** | 小程序从启动到首页渲染完成 | < 3s |
| **页面切换时间** | 页面间导航的平均时间 | < 500ms |
| **页面渲染时间** | 单个页面的渲染耗时 | < 1s |
| **接口请求时间** | 网络请求的平均耗时 | < 1s |
| **内存占用** | 小程序运行时内存使用 | < 100MB |
| **CPU占用** | 小程序运行时CPU使用率 | < 30% |

### 3.3 测试场景

#### 场景1：小程序启动性能

```
启动 → 加载首页 → 渲染菜品列表 → 点击菜品
```

#### 场景2：点餐流程性能

```
首页 → 选菜 → 购物车 → 确认订单 → 提交订单
```

#### 场景3：页面切换性能

```
首页 ↔ 订单列表 ↔ 订单详情 ↔ 我的页面
```

#### 场景4：弱网环境测试

```
模拟网络：2G/3G/弱4G
测试内容：页面加载、数据请求、图片加载
```

### 3.4 测试用例

| 测试项 | 测试方法 | 预期结果 |
|--------|----------|----------|
| 首页加载 | 冷启动小程序 | 首次加载 < 3s |
| 菜品列表渲染 | 进入点餐页面 | 列表渲染 < 1s |
| 购物车操作 | 添加/删除菜品 | 响应 < 300ms |
| 订单提交 | 提交订单流程 | 提交 < 2s |
| 图片加载 | 查看菜品图片 | 图片加载 < 2s |
| 页面切换 | 切换不同页面 | 切换 < 500ms |

---

## 4. 设备兼容性测试方案

### 4.1 测试设备范围

| 设备类型 | 系统 | 屏幕尺寸 |
|----------|------|----------|
| iPhone 14 | iOS 17+ | 6.1英寸 |
| iPhone 12 | iOS 16 | 6.1英寸 |
| iPhone SE | iOS 15 | 4.7英寸 |
| 华为 Mate 60 | Android 14 | 6.82英寸 |
| 小米 14 | Android 14 | 6.36英寸 |
| 荣耀 Magic6 | Android 14 | 6.8英寸 |
| 低端安卓机 | Android 10 | 5.5-6.0英寸 |

### 4.2 兼容性测试要点

| 测试项 | 测试内容 |
|--------|----------|
| **布局适配** | 页面布局在不同屏幕尺寸上的显示效果 |
| **字体显示** | 文字大小、清晰度、换行情况 |
| **图片显示** | 图片缩放、拉伸、加载情况 |
| **交互操作** | 按钮点击、滑动、表单输入 |
| **特殊控件** | 弹窗、下拉菜单、滚动列表 |
| **网络请求** | 不同网络环境下的数据请求 |

---

## 5. 测试执行流程

### 5.1 测试准备

1. **环境准备**：
   - 启动后端服务：`pnpm --filter server start`
   - 确保数据库已初始化
   - 准备测试数据（菜品、桌台等）

2. **工具安装**：
   ```bash
   npm install -g artillery
   ```

### 5.2 测试执行顺序

```mermaid
graph TD
    A[后端压力测试] --> B[小程序性能测试]
    B --> C[设备兼容性测试]
    C --> D[生成测试报告]
```

### 5.3 测试命令

```bash
# 场景1：高并发下单
artillery run performance/test-order.yaml --output reports/order-report.json

# 场景2：高频查询
artillery run performance/test-query.yaml --output reports/query-report.json

# 场景3：混合负载
artillery run performance/test-mixed.yaml --output reports/mixed-report.json

# 生成HTML报告
artillery report reports/order-report.json -o reports/order-report.html
```

---

## 6. 测试报告内容

### 6.1 后端性能报告

| 报告项 | 内容 |
|--------|------|
| **概述** | 测试时间、环境、场景描述 |
| **响应时间** | 平均响应时间、P95、P99 |
| **吞吐量** | 每秒请求数、峰值吞吐量 |
| **错误率** | 各类错误的比例和数量 |
| **服务器资源** | CPU、内存使用率图表 |
| **瓶颈分析** | 性能瓶颈识别和优化建议 |

### 6.2 小程序性能报告

| 报告项 | 内容 |
|--------|------|
| **加载性能** | 首次加载时间、页面渲染时间 |
| **交互性能** | 操作响应时间、动画流畅度 |
| **内存使用** | 内存占用峰值、内存泄漏检测 |
| **兼容性** | 各设备测试结果汇总 |

---

## 7. 测试约束

1. **禁止修改代码**：测试过程中不得修改源代码
2. **测试数据隔离**：使用独立的测试数据库
3. **性能测试在测试环境执行**：避免影响生产环境
4. **记录所有测试结果**：生成详细的测试报告

---

**文档版本**: v1.0  
**创建时间**: 2026-05-18  
**适用项目**: 餐饮点餐系统