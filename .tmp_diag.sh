#!/bin/bash
echo '=== 1. PM2 进程状态 ==='
pm2 list

echo ''
echo '=== 2. 最近 80 行 ws 相关日志 ==='
pm2 logs scanfood-api --lines 80 --nostream 2>&1 | grep -E 'WebSocket|authenticated|subscribed|disconnected|terminating' | tail -25

echo ''
echo '=== 3. 后端是否发出 orderStatusChanged ==='
pm2 logs scanfood-api --lines 500 --nostream 2>&1 | grep -E 'order status change|orderStatusChanged|Notified' | tail -15

echo ''
echo '=== 4. 当前活跃的 ws 客户端数量（从内存看）==='
pm2 logs scanfood-api --lines 500 --nostream 2>&1 | grep -E 'admin clients|table .* clients|order .* clients' | tail -10

echo ''
echo '=== 5. nginx ws 请求最近状态 ==='
tail -30 /www/wwwlogs/scanfood-admin.com.log 2>/dev/null | grep -E 'GET /ws|api' | tail -20

echo ''
echo '=== 6. 直接 curl /api/health 验证 ==='
curl -s http://localhost:3000/api/health
echo ''
