/**
 * JWT 密钥获取（强校验）
 *
 * 安全红线：
 *  - 必须从环境变量 JWT_SECRET 读取
 *  - 长度至少 32 字符（即使是十六进制也能保证 ~128 bit 熵）
 *  - 不允许任何 fallback / 默认值（早期 'default-secret' 兜底是漏洞）
 *
 * 启动期调用：缺失/过短直接抛错，让 Nest 启动失败
 *  → 这是有意设计：宁可起不来，也不能用弱密钥跑生产
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.trim().length === 0) {
    throw new Error(
      'JWT_SECRET 未设置！请在 server/.env 中配置一个至少 32 字符的随机字符串。' +
      ' 生成命令：node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64\'))"',
    );
  }
  if (secret.length < 32) {
    throw new Error(
      `JWT_SECRET 太短（当前 ${secret.length} 字符），至少需要 32 字符。` +
      ' 弱密钥会导致 JWT 容易被暴力破解。',
    );
  }
  // 检测占位值（防止生产环境忘改）
  const PLACEHOLDER_PATTERNS = [
    /^your-/i,            // your-secret / your-super-...
    /^change[-_]?me/i,    // change-me / changeme
    /^placeholder/i,      // placeholder
    /^xxx/i,              // xxx / XXXX
    /^todo/i,             // TODO
    /^example/i,          // example
    /^test[-_]?secret/i,  // test-secret
    /^default/i,          // default-secret
  ];
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(secret)) {
      throw new Error(
        `JWT_SECRET 看起来是占位值（匹配 ${pattern}），请生成一个强随机字符串替换。` +
        ' 命令：node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64\'))"',
      );
    }
  }
  return secret;
}
