# Cpolar 隧道地址获取指南（给 AI 用）

> 隧道每天自动刷新一次，需要重新获取公网 URL。按下面步骤来，30 秒搞定。

## 服务器信息

- 主机：`root@121.89.92.255`（阿里云 ECS，已配公钥免密）
- 隧道配置：`/usr/local/etc/cpolar/cpolar.yml`
- 隧道名：`scanfood`（HTTP → localhost:3000）

## 三步获取最新公网地址

### 第一步：重启 cpolar

```bash
ssh root@121.89.92.255 'systemctl restart cpolar && sleep 3'
```

### 第二步：从日志提取新地址

```bash
ssh root@121.89.92.255 'grep -oP "https://[a-z0-9.-]+\.cpolar\.\w+" /var/log/cpolar/access.log.$(date +%Y%m%d) | sort -u | tail -1'
```

> **核心原理：** cpolar 的 Worker 日志里会记录公网 URL，用 grep 正则直接从今天日志提取，比调 API 快得多。API（localhost:4040）经常返回空 tunnels 列表，不可靠。

### 第三步：验证新地址能通

拿到新 URL（例如 `https://xxxx.r19.cpolar.top`）后：

```bash
ssh root@121.89.92.255 'curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 <新URL>/api/notif/push/vapid-key'
```

返回 `200` 即可。

## 更新小程序配置

获取到新地址后，同步更新 `xiaochengxu/config.js` 中的 `TUNNEL.SERVER_URL`：

```js
TUNNEL: {
    SERVER_URL: 'https://<新地址>.cpolar.top',
    desc: '阿里云穿'
},
```

## 已知信息（备忘）

| 项 | 值 |
|---|---|
| authtoken | 在 `/usr/local/etc/cpolar/cpolar.yml` 已配 |
| 日志目录 | `/var/log/cpolar/` |
| 日志命名 | 按天分割，格式 `access.log.YYYYMMDD` |
| 今天日志 | `/var/log/cpolar/access.log.$(date +%Y%m%d)` |
| 旧域名格式 | `https://<8位hex>.r19.cpolar.top` |
| 地址变化 | 每次 `systemctl restart cpolar` 会变 |
| Web 仪表盘 | `http://127.0.0.1:4040`（但 tunnels 经常显示空，不建议依赖） |

## 完整一键脚本

把上面三步合成一条命令：

```bash
# 重启
ssh root@121.89.92.255 'systemctl restart cpolar && sleep 3'

# 获取新 URL
URL=$(ssh root@121.89.92.255 'grep -oP "https://[a-z0-9.-]+\.cpolar\.\w+" /var/log/cpolar/access.log.$(date +%Y%m%d) | sort -u | tail -1')
echo "新地址: $URL"

# 验证
ssh root@121.89.92.255 "curl -s -o /dev/null -w 'status=%{http_code}\n' --connect-timeout 5 $URL/api/notif/push/vapid-key"
```
