# 依赖健康度记录

## 目标
让项目可以在任意机器上 `npm install` 干净落地（无 `--legacy-peer-deps`），消除版本冲突。

## Node 版本要求
- `node >= 20 < 23`
- `npm >= 10`
- 已写入两个 `package.json` 的 `engines` 字段
- 项目根目录 `.nvmrc = 20`

## 治理前问题（aa1e431）
- `npm ls` 报 5 处 invalid（NestJS 10 + 11 混用）
- `npm install` 必须加 `--legacy-peer-deps` 才能跑通
- root 装了 `express@5`，但 NestJS 10 内部用 `express@4`，**双版本共存**
- `@types/multer@2` vs `multer@1`（类型版本错位）

## 治理后状态
- `npm install` 干净落地，**0 invalid**
- 所有 `@nestjs/*` 包统一在 **10.4.x** 系列
- `express` 仅由 NestJS 内部管理（root 不装）
- `@types/express@4` 匹配运行时
- `@types/multer@1.4` 匹配运行时
- 88 个 PBT 全过 + nest build 0 错误 + admin-web tsc 0 错误 + 真实启动验证

## 关键版本对照表（server）

| 包 | 版本 | 备注 |
|---|---|---|
| @nestjs/common / core / platform-express / websockets | 10.4.22 | 锁定 |
| @nestjs/jwt | 10.2.0 | 从 11 降回 |
| @nestjs/config | 3.3.0 | 从 4 降回 |
| @nestjs/passport | 10.0.3 | 从 11 降回 |
| @nestjs/platform-socket.io | 10.4.22 | 从 11.1 降回 |
| @nestjs/schedule | 4.1.2 | 从 6 降回 |
| dotenv | 16.6.1 | 17 是 ESM-only |
| uuid | 10.0.0 | 14 是 ESM-only |
| zod | 3.23.x | 4 与 drizzle-zod 不兼容 |
| express-rate-limit | 7.5.1 | 8 要 express@5 |

## 安全回滚

万一治理后跑不起来，立即回滚：

```bash
git reset --hard backup-before-deps-cleanup
# 或
git checkout backup/before-deps-cleanup
```

## 跨机器部署

```bash
nvm use            # 自动用 .nvmrc 锁定的 Node 20
cd server   && npm install  # 不带 legacy-peer-deps，干净落地
cd admin-web && npm install
```

## 已知 deprecated（无法立即升级）
- `multer@1.4.5-lts.2` — multer 2.x 改了 API，会破坏既有上传逻辑，下个独立 PR 再升
- `inflight@1.0.6` — 是间接依赖（npm 自身用），无法控制
