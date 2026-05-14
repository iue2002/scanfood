# 设计指南 - 桌码点餐系统

## 1. 品牌定位

**应用定位**：单门店智能点餐系统，连接顾客与商家，提供便捷的扫码点餐体验。

**设计风格**：
- 用户端：温暖、亲切、易用，营造舒适的点餐氛围
- 商家端：专业、简洁、高效，便于快速管理操作

**目标用户**：
- 用户端：到店就餐的顾客（覆盖各年龄段）
- 商家端：餐厅管理人员、收银员

## 2. 配色方案

### 主色板

**主色（品牌色）**：
- 主色：`bg-orange-500` / `text-orange-500` (#f97316) - 温暖的橙色，代表美食与热情
- 主色深：`bg-orange-600` (#ea580c)
- 主色浅：`bg-orange-100` (#ffedd5)

**辅助色**：
- 辅助色：`bg-amber-500` (#f59e0b) - 金黄色，强调美食元素
- 成功色：`bg-green-500` (#22c55e) - 已完成/已结账状态
- 警告色：`bg-yellow-500` (#eab308) - 待处理状态
- 危险色：`bg-red-500` (#ef4444) - 取消/退款状态

### 中性色

- 深色文字：`text-gray-900` (#111827)
- 正文文字：`text-gray-700` (#374151)
- 次要文字：`text-gray-500` (#6b7280)
- 占位文字：`text-gray-400` (#9ca3af)
- 边框色：`border-gray-200` (#e5e7eb)
- 背景色：`bg-gray-50` (#f9fafb)
- 白色背景：`bg-white` (#ffffff)

### 语义色

- 空闲状态：`text-green-600` / `bg-green-50`
- 占用状态：`text-orange-600` / `bg-orange-50`
- 结账状态：`text-blue-600` / `bg-blue-50`
- 已下架：`text-gray-400` / `bg-gray-100`

## 3. 字体规范

- H1 标题：`text-2xl font-bold` (24px)
- H2 标题：`text-xl font-semibold` (20px)
- H3 标题：`text-lg font-semibold` (18px)
- 正文：`text-base` (16px)
- 小字：`text-sm` (14px)
- 说明文字：`text-xs text-gray-500` (12px)
- 价格：`text-lg font-bold text-orange-600`

## 4. 间距系统

- 页面边距：`p-4` (16px)
- 卡片内边距：`p-4` (16px)
- 列表间距：`gap-3` (12px)
- 表单项间距：`space-y-3`
- 按钮间距：`gap-2` (8px)

## 5. 组件使用原则

**组件选型约束**：
- **按钮、输入框、弹窗、Tabs、Toast、Card、Badge、Select、Checkbox、Table 等通用组件必须优先从 `@/components/ui/*` 导入**
- **禁止用 `View/Text` + Tailwind 手搓上述通用组件的外观与交互**
- **页面开发前必须先拆分 UI 单元**，再映射到 `@/components/ui/*` 组件库
- 仅容器布局（View）和原生能力（Camera、Canvas 等）使用 `@tarojs/components`

**常用组件映射**：
- 操作按钮 → `Button` (`@/components/ui/button`)
- 表单输入 → `Input` / `Textarea` (`@/components/ui/input` / `textarea`)
- 信息卡片 → `Card` (`@/components/ui/card`)
- 状态标签 → `Badge` (`@/components/ui/badge`)
- 选择器 → `Select` / `RadioGroup` (`@/components/ui/select` / `radio-group`)
- 弹窗确认 → `Dialog` / `AlertDialog` (`@/components/ui/dialog` / `alert-dialog`)
- 提示消息 → `Toast` / `Sonner` (`@/components/ui/toast` / `sonner`)
- 标签切换 → `Tabs` (`@/components/ui/tabs`)
- 数据表格 → `Table` (`@/components/ui/table`)
- 加载状态 → `Skeleton` (`@/components/ui/skeleton`)

## 6. 导航结构

### 用户端小程序（无 TabBar，页面流式导航）

```
登录页 → 扫码/点餐页 → 订单详情页
```

- 登录页：`pages/login/index`
- 点餐页：`pages/order/index` (扫码后进入)
- 订单详情：`pages/order-detail/index`

### 商家后台Web系统（TabBar 导航）

```
TabBar: 桌台 | 订单 | 菜品 | 统计 | 我的
```

- 桌台管理：`pages/admin/tables/index`
- 订单管理：`pages/admin/orders/index`
- 菜品管理：`pages/admin/dishes/index`
- 支付退款：`pages/admin/payment/index`
- 数据统计：`pages/admin/statistics/index`

**跳转规范**：
- TabBar 页面跳转：`Taro.switchTab()`
- 普通页面跳转：`Taro.navigateTo()`
- 返回上一页：`Taro.navigateBack()`

## 7. 页面容器规范

### 卡片容器
```tsx
<Card className="bg-white rounded-xl shadow-sm">
  <CardContent className="p-4">
    {/* 内容 */}
  </CardContent>
</Card>
```

### 列表项容器
```tsx
<View className="bg-white rounded-lg p-3 mb-2">
  {/* 列表项内容 */}
</View>
```

## 8. 小程序约束

### 包体积
- 单包不超过 2MB，总包不超过 20MB
- 图片、视频必须上传到 TOS 对象存储
- 仅 TabBar 图标允许本地存储（`src/assets/tabbar/`）

### 性能优化
- 列表使用虚拟滚动（长列表场景）
- 图片使用懒加载
- 避免频繁 `setData`
- 使用 `useMemo` / `useCallback` 优化渲染

### 跨端兼容
- 所有垂直 Text 添加 `block` 类
- Input/Textarea 用 View 包裹，样式放 View
- Fixed + Flex 用 inline style
- 平台检测：`[Taro.ENV_TYPE.WEAPP, Taro.ENV_TYPE.TT].includes(Taro.getEnv())`

## 9. 状态展示

### 空状态
```tsx
<View className="flex flex-col items-center justify-center py-12">
  <Text className="block text-gray-400 text-sm">暂无数据</Text>
</View>
```

### 加载状态
```tsx
<View className="flex items-center justify-center py-12">
  <Skeleton className="w-full h-20" />
</View>
```

### 订单状态标签
- 已提交：`<Badge variant="warning">已提交</Badge>`
- 已打印：`<Badge variant="default">已打印</Badge>`
- 已结账：`<Badge variant="success">已结账</Badge>`
- 已取消：`<Badge variant="destructive">已取消</Badge>`
