import 'dotenv/config';
import type { Config } from 'drizzle-kit';

/**
 * Drizzle Kit 配置
 *
 * 用途：从 schema.ts 生成数据库迁移 SQL
 *
 * 生成全新初始化 SQL（推荐，部署用）：
 *   npx drizzle-kit generate --name=init
 *
 * 推送到数据库（开发期，不建议生产用）：
 *   npx drizzle-kit push
 *
 * 输出目录：drizzle/ (沿用现有目录，新文件按时间戳命名不冲突)
 */
export default {
  schema: './src/storage/database/shared/schema.ts',
  out: './drizzle',
  dialect: 'mysql',
  dbCredentials: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'scanfood',
  },
} satisfies Config;
