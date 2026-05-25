// public/notification-click.js
// 通过 vite-plugin-pwa 的 workbox.importScripts 注入到生成的 sw.js 中
//
// 作用：处理用户点击桌面通知 / 锁屏通知的事件
//   1. 如果已有 admin tab 打开 → focus 它 + postMessage 让前端跳到目标 URL
//   2. 如果没有打开的 tab → 新开 admin 并跳到目标 URL
//
// 数据约定：showNotification 时传 options.data = { url: '/orders?focus=123' }
// 这个 url 是相对路径，会和 self.registration.scope 拼成完整 URL

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      // 计算完整 target URL（基于 SW scope）
      const baseUrl = new URL(self.registration.scope);
      const fullTargetUrl = new URL(targetUrl, baseUrl).href;

      // 优先复用已打开的 admin tab
      for (const client of allClients) {
        const clientUrl = new URL(client.url);
        // 同源 admin tab → focus + 通过 postMessage 让前端 navigate
        if (clientUrl.origin === baseUrl.origin) {
          try {
            await client.focus();
            client.postMessage({
              type: 'NOTIFICATION_CLICK',
              url: targetUrl,
            });
            return;
          } catch (e) {
            // focus 失败（多窗口竞争）继续 fallback
          }
        }
      }

      // 没找到打开的 tab，新开窗口
      if (self.clients.openWindow) {
        await self.clients.openWindow(fullTargetUrl);
      }
    })()
  );
});
