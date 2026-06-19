// public/notification-click.js
// 通过 vite-plugin-pwa 的 workbox.importScripts 注入到生成的 sw.js 中
//
// 作用：
//   1. 接收 Web Push 推送事件 → 弹通知
//   2. 处理用户点击通知（桌面 / 锁屏） → focus 已有 admin tab 或新开
//
// 数据约定：
//   服务端发的 push payload JSON：{ title, body, url, tag, icon }
//   showNotification options.data = { url } → notificationclick 时拿来跳转

// ===== 1. 接收 Web Push 推送事件 =====
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload = {};
  try {
    payload = event.data.json();
  } catch (e) {
    payload = { title: '新通知', body: event.data.text() };
  }

  const title = payload.title || '新通知';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icon-192.png',
    badge: '/icon-192.png',
    tag: payload.tag,
    data: { url: payload.url || '/' },
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ===== 2. 用户点击通知 =====
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
        // 同源 tab → focus + 通过 postMessage 让前端 navigate
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

      // 没找到打开的 tab，用 openWindow 打开完整 URL
      if (self.clients.openWindow) {
        await self.clients.openWindow(fullTargetUrl);
      }
    })()
  );
});
