# 构建阶段
FROM node:22-alpine AS builder

WORKDIR /app

# 复制依赖文件
COPY package.json ./

# 安装 pnpm
RUN npm install -g pnpm@9.0.0

# 安装依赖（不使用 lockfile，因为 monorepo 结构）
RUN pnpm install

# 复制源代码
COPY . .

# 构建
RUN pnpm build

# ===== 生产阶段 =====
FROM node:22-alpine AS production

# 安全加固: 创建非 root 用户
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup

WORKDIR /app

# 安装 pnpm
RUN npm install -g pnpm@9.0.0

# 复制依赖文件
COPY package.json ./

# 只安装生产依赖
RUN pnpm install --production

# 从构建阶段复制构建产物
COPY --from=builder /app/dist/src ./dist
COPY --from=builder /app/drizzle ./drizzle

# 创建上传、日志目录并设置权限
RUN mkdir -p uploads logs && \
    chown -R appuser:appgroup /app

# 切换到非 root 用户
USER appuser

# 暴露端口
EXPOSE 3000

# 启动命令
CMD ["node", "dist/main.js", "-p", "3000"]
