/**
 * client-ip.ts — P2-1：统一的客户端 IP 提取
 *
 * 背景：原先 employee/export/audit controller、auth.controller、orders.gateway
 * 各自手抄一份 X-Forwarded-For 解析逻辑（4+ 处重复），口径不一且易漂移。
 *
 * 现在 main.ts 已设 `trust proxy = 1`，Express 会据此把 req.ip 解析为
 * X-Forwarded-For 链中的真实客户端 IP。因此优先取 req.ip；
 * 仅在 req.ip 缺失（如非 HTTP 上下文）时回退到手动解析。
 *
 * 同时提供 extractIpFromHeaders 给 WebSocket 升级握手（拿不到 express req.ip）使用。
 */

/** 从 Express 请求对象提取客户端 IP（HTTP 控制器/拦截器用） */
export function extractClientIp(req: any): string {
  // trust proxy 生效后 req.ip 已是真实客户端 IP
  const ip = req?.ip;
  if (typeof ip === 'string' && ip.length > 0) {
    return normalizeIp(ip);
  }
  // 回退：手动解析（理论上很少走到）
  return extractIpFromHeaders(req?.headers, req?.socket?.remoteAddress ?? req?.connection?.remoteAddress);
}

/**
 * 从原始 headers + socket 远端地址提取客户端 IP（WebSocket 握手等无 req.ip 场景用）。
 * X-Forwarded-For 可能是 "client, proxy1, proxy2"，取第一段。
 */
export function extractIpFromHeaders(headers: any, remoteAddress?: string): string {
  const xff = headers?.['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    const first = xff.split(',')[0]?.trim();
    if (first) return normalizeIp(first);
  }
  if (Array.isArray(xff) && xff.length > 0) {
    const first = String(xff[0]).split(',')[0]?.trim();
    if (first) return normalizeIp(first);
  }
  if (remoteAddress) return normalizeIp(remoteAddress);
  return 'unknown';
}

/** 归一化：去掉 IPv4-mapped IPv6 前缀 ::ffff: */
function normalizeIp(ip: string): string {
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}
