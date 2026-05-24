# 构建阶段
FROM node:20-alpine AS builder

WORKDIR /app

# 复制依赖锁定文件（npm，不是 pnpm；项目锁定 npm + Node 20）
COPY package.json package-lock.json ./

# 用 npm ci 严格按 lockfile 安装（与本地一致，避免漂移）
RUN npm ci

# 复制源代码
COPY . .

# 构建（NestJS 输出到 dist/src/）
RUN npm run build

# ===== 生产阶段 =====
FROM node:20-alpine AS production

# 安全加固: 非 root 用户运行
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup

WORKDIR /app

# 复制依赖锁定文件
COPY package.json package-lock.json ./

# 只装生产依赖
RUN npm ci --omit=dev && npm cache clean --force

# 从构建阶段复制产物
COPY --from=builder /app/dist/src ./dist
COPY --from=builder /app/drizzle ./drizzle

# 创建上传 / 日志目录并设置权限
RUN mkdir -p uploads logs && \
    chown -R appuser:appgroup /app

# 切换到非 root 用户
USER appuser

# 暴露端口
EXPOSE 3000

# 启动命令
CMD ["node", "dist/main.js", "-p", "3000"]
