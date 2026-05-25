#!/bin/bash
echo "=== 1. 最近 5 分钟所有 ws 推送（含新加的 notifyAllAdmins 详细日志） ==="
pm2 logs scanfood-api --lines 200 --nostream 2>&1 | grep -E "Notified|notifyAllAdmins|Total admin" | tail -20

echo ""
echo "=== 2. 最近的加餐请求 ==="
tail -200 /www/wwwlogs/scanfood-admin.com.log 2>/dev/null | grep -iE "POST.*sync-add-more|POST.*items" | tail -5

echo ""
echo "=== 3. 当前后端版本（看是否 push 了新代码） ==="
cd /www/wwwroot/scanfood && git log --oneline -3
