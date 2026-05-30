/**
 * tests/setup.ts — 集成测试基础设施
 *
 * 用 NestFactory.create 启动真实 App（非 Test.createTestingModule）
 * 测试用内存 HTTP Server，无需端口。
 */
import { NestFactory } from '@nestjs/core';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/filters/all-exceptions.filter';
import { HttpStatusInterceptor } from '../src/interceptors/http-status.interceptor';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { pool } from '../src/storage/database/mysql-client';

let app: INestApplication;
let httpServer: any;

const TEST_USERS: Record<string, { username: string; password: string; role: string }> = {
  owner:   { username: 'test_owner',   password: 'Test123456', role: 'admin' },
  manager: { username: 'test_manager', password: 'Test123456', role: 'manager' },
  cashier: { username: 'test_cashier', password: 'Test123456', role: 'cashier' },
  waiter:  { username: 'test_waiter',  password: 'Test123456', role: 'waiter' },
};

async function seedTestUsers(): Promise<void> {
  const hash = await bcrypt.hash('Test123456', 10);
  for (const [key, u] of Object.entries(TEST_USERS)) {
    await pool.query(
      `INSERT INTO users (username, password, nickname, role, status)
       VALUES (?, ?, ?, ?, 'active')
       ON DUPLICATE KEY UPDATE password = VALUES(password), role = VALUES(role), status = 'active'`,
      [u.username, hash, key, u.role],
    );
  }
}

export async function bootstrapTestApp(): Promise<INestApplication> {
  if (app) return app;

  app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true }, disableErrorMessages: false }));
  app.useGlobalInterceptors(new HttpStatusInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  httpServer = app.getHttpServer();
  await seedTestUsers();
  return app;
}

/** supertest 实例，自动加 /api 全局前缀 */
export function api() {
  const r = request(httpServer);
  // 代理常见 HTTP 方法，自动加 /api
  const wrap = (method: string, url: string) => {
    const fullUrl = url.startsWith('/api') ? url : `/api${url}`;
    return (r as any)[method](fullUrl);
  };
  return {
    get: (url: string) => wrap('get', url),
    post: (url: string) => wrap('post', url),
    put: (url: string) => wrap('put', url),
    delete: (url: string) => wrap('delete', url),
  };
}

export async function loginAs(role: string): Promise<string> {
  const u = TEST_USERS[role];
  if (!u) throw new Error(`Unknown test role: ${role}`);
  const res = await api().post('/auth/login').send({ username: u.username, password: u.password });
  if (res.status !== 200) throw new Error(`Login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.access_token;
}

export async function loginAsCustomer(): Promise<string> {
  const ts = Date.now();
  const username = `test_cust_${ts}`;
  const reg = await api().post('/auth/register').send({ username, password: 'Test123456', nickname: 'C', role: 'customer' });
  if (reg.status === 200) return reg.body.access_token;
  return loginAs('owner'); // fallback
}

export function authReq(token: string) {
  return {
    get: (url: string) => api().get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string) => api().post(url).set('Authorization', `Bearer ${token}`),
    put: (url: string) => api().put(url).set('Authorization', `Bearer ${token}`),
    delete: (url: string) => api().delete(url).set('Authorization', `Bearer ${token}`),
  };
}
