import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    // 仅扫描我们关心的目录，避免误跑业务代码 spec
    include: [
      'src/**/*.spec.ts',
      'src/**/*.property.spec.ts',
      'tests/**/*.spec.ts',
    ],
    // 默认环境 node（NestJS 后端）
    environment: 'node',
    // PBT 单测可能要跑较长时间，给 30 秒
    testTimeout: 30000,
    // 并发：默认开
    pool: 'threads',
    // reporter 简洁
    reporters: ['default'],
  },
});
