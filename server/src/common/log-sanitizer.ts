/**
 * log-sanitizer.ts — P2-3：日志脱敏工具
 *
 * 对日志输出中的敏感字段做递归替换为 '[REDACTED]'。
 * 不修改原始对象（immutable 拷贝）。
 *
 * 匹配口径：与 AuditCore.redact 对齐，采用「小写子串包含」匹配
 * （原先用精确 Set 匹配，导致 accessToken/smtpPass 等驼峰条目转小写后永不命中，
 *   且 userToken / x-api-key 等带前后缀字段漏网）。子串匹配覆盖更全、更稳。
 */

// 敏感字段子串（全小写）。key.toLowerCase() 命中任一子串即脱敏。
const SENSITIVE_SUBSTRINGS = [
  'password',
  'pwd',
  'token',
  'authorization',
  'openid',
  'secret',
  'webhook',
  'device_key',
  'devicekey',
  'api_key',
  'apikey',
  'private_key',
  'smtp_pass',
  'smtppass',
  'vapid_private',
];

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_SUBSTRINGS.some((s) => lower.includes(s));
}

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
    if (isSensitiveKey(key)) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null && !(value instanceof Date) && !(value instanceof RegExp)) {
      result[key] = sanitizeLog(value, depth + 1);
    } else {
      result[key] = value;
    }
  }
  return result;
}
