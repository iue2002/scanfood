# Scanfood 部署指南（给 AI 协作工具）

> 本文档面向另一台机器上的 AI 工具，目标是把仓库改动部署到生产环境。**严格按步骤来**，每一步检查上一步是否成功再继续。

## 一、生产环境拓扑

| 项 | 值 |
|---|---|
| 主机 | 阿里云 ECS `121.89.92.255`（Alibaba Cloud Linux 3） |
| SSH | `ssh root@121.89.92.255`（已配公钥免密） |
| Node | 20.20.2 / npm 10.8.2 / pm2 6.0.14 |
| Nginx | 1.28.0 |
| MySQL | 8.4.8（库名 `scanfood`，用户 `scanfood`） |
| Web 域名 | `https://116ca2f8.r19.cpolar.top`（cpolar 隧道） |

### 服务器目录

| 路径 | 用途 |
|---|---|
| `/www/wwwroot/scanfood/` | 仓库根（含 `server/`、`admin-web/`、`xiaochengxu/`） |
| `/www/wwwroot/scanfood/server/` | NestJS 后端，pm2 进程名 `scanfood-api`，监听 `:3000` |
| `/www/wwwroot/scanfood/server/.env` | 后端环境变量（**不要 commit**） |
| `/www/wwwroot/scanfood-admin.com/` | 前端 admin-web 静态文件目录（nginx 站点根） |
| `/www/wwwroot/scanfood/server/uploads/` | 用户上传文件（菜品 / 头像 / 桌台二维码） |

### Git 仓库

- 远端：`https://github.com/iue2002/scanfood.git`
- 主分支：`main`
- 提交规范：commitlint（`feat:` `fix:` `chore:` `refactor:` `docs:` 等前缀，中文 message OK）

---

## 二、本地准备（开发机）

部署前确保本地已经：

1. `cd server && npm run build` 通过
2. `cd server && npm test` 通过（98+ 个 vitest 用例全过）
3. `cd admin-web && npx tsc --noEmit && npm run build` 通过
4. 改动已 commit + `git push origin main`

> ⚠️ 不在生产服务器上跑 `npm test`（vitest 容易开 watch 模式或拉满 CPU）。

---

## 三、后端部署（server/）

### 3.1 标准流程（无新迁移）

```bash
ssh root@121.89.92.255 'set -e
cd /www/wwwroot/scanfood
git fetch origin
git reset --hard origin/main
cd server
npm install --no-audit --no-fund 2>&1 | tail -3
npm run build 2>&1 | tail -3
pm2 restart scanfood-api --update-env
sleep 3
pm2 status scanfood-api
'
```

成功标志：
- `npm run build` 末尾无 error
- `pm2 status` 显示 `online`，pid 已变化
- 没有 `errored` 或 `restart` 风暴

### 3.2 含数据库迁移的流程

如果本次提交在 `server/drizzle/` 新增了 `00XX_*.sql`，按编号顺序、**幂等** 执行：

```bash
ssh root@121.89.92.255 'set -e
cd /www/wwwroot/scanfood
git fetch origin
git reset --hard origin/main

# 解析 .env 拿到数据库密码
DB_PASS=$(grep -E "^DB_PASSWORD=" /www/wwwroot/scanfood/server/.env | cut -d= -f2- | tr -d "\"" | tr -d "'\''")
DB_USER=$(grep -E "^DB_USER=" /www/wwwroot/scanfood/server/.env | cut -d= -f2-)
DB_NAME=$(grep -E "^DB_NAME=" /www/wwwroot/scanfood/server/.env | cut -d= -f2-)
DB_USER=${DB_USER:-scanfood}
DB_NAME=${DB_NAME:-scanfood}

# 例：执行 0003_xxx.sql。改 SQL 文件名前先 cat 看一下，确认是 idempotent
MYSQL_PWD="$DB_PASS" mysql -u"$DB_USER" "$DB_NAME" --default-character-set=utf8mb4 \
  < /www/wwwroot/scanfood/server/drizzle/0003_xxx.sql

cd server
npm install --no-audit --no-fund 2>&1 | tail -3
npm run build 2>&1 | tail -3
pm2 restart scanfood-api --update-env
sleep 3
pm2 status scanfood-api
'
```

迁移执行规则：
- 所有 SQL 必须是 **idempotent** 的：`CREATE TABLE IF NOT EXISTS`、`INSERT ... ON DUPLICATE KEY UPDATE`、索引内联到建表里（避免 `CREATE INDEX` 重复报 1061）
- 既有表 **只能 `ADD COLUMN`**，不改列名/类型（红线）
- 执行前先 `SHOW TABLES LIKE 'xxx'` 判断是否已迁移过；已经存在的可跳过
- 跨编码：永远带 `--default-character-set=utf8mb4`，防中文乱码

### 3.3 验证后端

```bash
# 健康检查（VAPID 端点，公开）
ssh root@121.89.92.255 'curl -s -o /dev/null -w "status=%{http_code}\n" http://localhost:3000/api/notif/push/vapid-key'

# 查看新路由是否注册（NestJS 启动时打印 RouterExplorer）
ssh root@121.89.92.255 'pm2 logs scanfood-api --nostream --lines 400 2>/dev/null | grep -E "RouterExplorer.*<新路由的关键字>"'

# 查看运行时错误
ssh root@121.89.92.255 'pm2 logs scanfood-api --nostream --lines 100 --err 2>/dev/null'
```

---

## 四、前端部署（admin-web/）

admin-web 在**本地**构建，只把 `dist/` 同步到服务器；服务器不跑 `npm install`。

### 4.1 标准流程

本地（PowerShell / cmd）：

```powershell
# 1. 本地 build
cd admin-web
npm run build

# 2. 同步 dist 到服务器
scp -r admin-web/dist/* root@121.89.92.255:/www/wwwroot/scanfood-admin.com/

# 3. 修文件权限 + 清旧 hash 文件
ssh root@121.89.92.255 "set -e
cd /www/wwwroot/scanfood-admin.com
find . -not -name '.user.ini' -type d -exec chown www:www {} + 2>/dev/null
find . -not -name '.user.ini' -type f -exec chown www:www {} + 2>/dev/null
find . -type d -exec chmod 755 {} +
find . -type f -not -name '.user.ini' -exec chmod 644 {} +
# 仅保留最近 3 个 hash 副本，避免目录膨胀
cd assets && ls -t index-*.js heic2any-*.js index-*.css 2>/dev/null | tail -n +4 | xargs -I {} rm -v {} 2>/dev/null
ls -la /www/wwwroot/scanfood-admin.com/assets/ | head -8
"
```

> ⚠️ `.user.ini` 是宝塔 PHP 安全文件，**不要改它的属主和权限**，所以所有 `find` 都加 `-not -name '.user.ini'`。

### 4.2 验证前端

直接访问 `https://116ca2f8.r19.cpolar.top/`，浏览器硬刷新（Ctrl+Shift+R），确认：
- index.html 引用的新 hash 文件 200 OK
- Service Worker 不会卡在旧版本（PWA 的 sw.js 会自更新）

排错：
- 403 / 404：通常是文件权限或属主问题，重跑 `chown www:www` + `chmod 644/755`
- 502：nginx 上游配置可能指向不存在的端口，看 `/www/wwwlogs/scanfood-admin.com.error.log`

---

## 五、小程序（xiaochengxu/）

**不需要服务器部署**。修改后的步骤：

1. 用微信开发者工具打开 `xiaochengxu/` 目录
2. 编译报错 / 警告全消除（项目用 Skyline + SWC + lazyCodeLoading，对 ES 语法兼容性较挑剔）
3. 自测无问题后点"上传"，提交体验版到微信平台
4. 体验版 / 正式版的网络请求地址通过 `xiaochengxu/config.js` 切换：
   - `LOCAL`：`http://localhost:3000`（开发者工具调试）
   - `TUNNEL`：cpolar 内网穿透 https 地址
   - `PROD`：`https://www.ali88.online`

> Skyline 已知坑：数组 spread `[...arr]` 在 lazyCodeLoading 模式下会报 `_array_without_holes` 找不到，必须改成 `arr.slice()` 或 `[a].concat(b)`。对象 spread `{...obj}` 没问题。详见仓库 `AGENTS.md`。

---

## 六、回滚

### 6.1 后端回滚

```bash
ssh root@121.89.92.255 'set -e
cd /www/wwwroot/scanfood
git log --oneline -10                           # 找到要回到的 commit
git reset --hard <COMMIT_HASH>
cd server
npm install --no-audit --no-fund 2>&1 | tail -3
npm run build 2>&1 | tail -3
pm2 restart scanfood-api --update-env
'
```

### 6.2 前端回滚

前端没有自动备份。如果需要回滚：
1. 在本地 `git checkout <COMMIT_HASH>`，重新 build，scp 覆盖
2. 或者保留每次部署的 dist 副本（建议在 CI 里做，本项目目前没有）

### 6.3 数据库回滚

迁移表结构基本上 **不可逆**（`ADD COLUMN` 不要轻易删）。回滚方式：
1. 先回滚后端代码到不需要新列的版本
2. 新列暂时保留在表里（无害）
3. 后续如果确实要删，写新的迁移文件 `DROP COLUMN` 并明确风险

---

## 七、常用诊断命令

```bash
# 查看 pm2 状态
ssh root@121.89.92.255 'pm2 status'

# 实时尾随后端日志
ssh root@121.89.92.255 'pm2 logs scanfood-api --lines 50'

# 仅看错误
ssh root@121.89.92.255 'pm2 logs scanfood-api --err --nostream --lines 100'

# 查看 Nginx 访问 / 错误日志
ssh root@121.89.92.255 'tail -100 /www/wwwlogs/scanfood-admin.com.log'
ssh root@121.89.92.255 'tail -100 /www/wwwlogs/scanfood-admin.com.error.log'

# 查询数据库
ssh root@121.89.92.255 'DB_PASS=$(grep ^DB_PASSWORD= /www/wwwroot/scanfood/server/.env | cut -d= -f2-); MYSQL_PWD="$DB_PASS" mysql -uscanfood scanfood --default-character-set=utf8mb4 -e "SHOW TABLES;"'

# 检查 admin-web 部署时间
ssh root@121.89.92.255 'ls -la /www/wwwroot/scanfood-admin.com/assets/ | head -10'
```

---

## 八、安全提醒（红线）

1. **永远不要**把 `server/.env` commit 到 git；它含 AES_KEY、DB 密码、SMTP 凭据等
2. **永远不要**在生产改既有列的类型 / 名称（红线）
3. **永远不要**直接 `rm -rf /www/wwwroot/scanfood-admin.com/*` —— `.user.ini` 不能动
4. 部署前 commit 必须是 commitlint 规范前缀（feat / fix / chore / refactor / docs / test / style / perf / build / ci / revert）
5. 不要在生产 `npm install` 没在 `package.json` 里声明的包；要装新依赖先在本地装好提交 `package.json` + `package-lock.json`
6. PowerShell 把 git push 的输出当 stderr，看到 `xxx..yyy main -> main` 就是成功，不要被 exit code 1 误导

---

## 九、本次部署示例（2026-05-26：员工自助改用户名 / 改密码 + 小程序 SWC 兼容修复）

```bash
# 1. 本地 build + 测试 + push
cd server && npm test && npm run build && cd ..
cd admin-web && npx tsc --noEmit && npm run build && cd ..
git add -A && git commit -m "feat: ..."
git push origin main

# 2. 后端
ssh root@121.89.92.255 'set -e
cd /www/wwwroot/scanfood
git fetch origin && git reset --hard origin/main
cd server && npm install --no-audit --no-fund && npm run build
pm2 restart scanfood-api --update-env
sleep 3 && pm2 status scanfood-api
'

# 3. 前端
scp -r admin-web/dist/* root@121.89.92.255:/www/wwwroot/scanfood-admin.com/
ssh root@121.89.92.255 'cd /www/wwwroot/scanfood-admin.com && find . -not -name ".user.ini" \( -type d -o -type f \) -exec chown www:www {} + 2>/dev/null; find . -type d -exec chmod 755 {} +; find . -type f -not -name ".user.ini" -exec chmod 644 {} +'

# 4. 验证
ssh root@121.89.92.255 'curl -s -o /dev/null -w "status=%{http_code}\n" http://localhost:3000/api/notif/push/vapid-key'
ssh root@121.89.92.255 'pm2 logs scanfood-api --nostream --lines 200 | grep "merchant-ops/employees/me"'
```

输出应包含：
```
status=200
... [RouterExplorer] Mapped {/api/merchant-ops/employees/me/change-password, POST}
... [RouterExplorer] Mapped {/api/merchant-ops/employees/me/change-username, POST}
```
