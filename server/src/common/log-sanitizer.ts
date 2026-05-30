/**
 * log-sanitizer.ts — P2-3：日志脱敏工具
 *
 * 对日志输出中的敏感字段做递归替换为 '[REDACTED]'。
 * 不修改原始对象（immutable 拷贝）。
 *
 * 敏感字段列表（与 AuditCore.redact 保持一致 + 补充）：
 *   password, pwd, token, accessToken, refreshToken,
 *   authorization, openid, secret, webhook_url, webhook,
 *   device_key, devicekey, api_key, apikey, private_key,
 *   smtp_pass, smtpPass, vapid_private_key
 */

const SENSITIVE_KEYS = new Set([
  'password',
  'pwd',
  'token',
  'accessToken',
  'refreshtoken',
  'authorization',
  'openid',
  'secret',
  'webhook_url',
  'webhook',
  'device_key',
  'devicekey',
  'api_key',
  'apikey',
  'private_key',
  'smtp_pass',
  'smtppass',
  'vapid_private_key',
]);

/**
 * 递归脱敏：匹配敏感 key 的值替换为 '[REDACTED]'
 * 只处理 plain object/array，不处理 Date/RegExp 等特殊类型
 */
export function sanitizeLog(input: unknown, depth = 0): unknown {
  if (depth > 10) return input; // 防止循环引用死循环
  if (input === null || input === undefined) return input;
  if (typeof input !== 'object') return input;
  if (input instanceof Date) return input;
  if (input instanceof RegExp) return String(input);

  if (Array.isArray(input)) {
    return (input as unknown[]).map((item) => sanitizeLog(item, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null && !(value instanceof Date) && !(value instanceof RegExp)) {
      result[key] = sanitizeLog(value, depth + 1);
    } else {
      result[key] = value;
    }
  }
  return result;
}
