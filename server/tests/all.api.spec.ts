/**
 * tests/all.api.spec.ts — 全模块 API 集成测试
 * 覆盖：认证 / 菜品 / 桌台 / 顾客流程 / 商家流程
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { bootstrapTestApp, api, loginAs, loginAsCustomer, authReq } from './setup';

beforeAll(async () => {
  await bootstrapTestApp();
  // 给 App 一点额外时间完全初始化路由
  await new Promise(r => setTimeout(r, 2000));
}, 120000);

describe('Auth — 登录（用 setup 预设用户）', () => {
  it('owner 可登录', async () => {
    const token = await loginAs('owner');
    expect(token).toBeTruthy();
  });
  it('manager 可登录', async () => {
    const token = await loginAs('manager');
    expect(token).toBeTruthy();
  });
  it('customer 可注册+登录', async () => {
    const token = await loginAsCustomer();
    expect(token).toBeTruthy();
  });
});

describe('Auth — 公开注册限制', () => {
  it('注册 customer 成功', async () => {
    const res = await api().post('/auth/register').send({
      username: `wx_cust_${Date.now()}`, password: 'Test123456', nickname: '客', role: 'customer',
    });
    expect(res.status).toBe(200);
  });
  it('拒绝注册 admin', async () => {
    const res = await api().post('/auth/register').send({
      username: `hack_${Date.now()}`, password: 'Test123456', nickname: '黑', role: 'admin',
    });
    expect(res.status).toBe(400);
  });
});

describe('Auth — JWT & RBAC', () => {
  let cusToken: string;
  beforeAll(async () => { cusToken = await loginAsCustomer(); });

  it('无 token → 401', async () => {
    expect((await api().get('/orders')).status).toBe(401);
  });
  it('伪造 token → 401', async () => {
    expect((await api().get('/orders').set('Authorization', 'Bearer x.y.z')).status).toBe(401);
  });
  it('customer POST /dishes → 403', async () => {
    const { post } = authReq(cusToken);
    expect((await post('/dishes').send({ name: 'x', category_id: 1, price: '1' })).status).toBe(403);
  });
  it('customer POST /tables → 403', async () => {
    const { post } = authReq(cusToken);
    expect((await post('/tables').send({ table_number: '99' })).status).toBe(403);
  });
  it('customer GET /refunds → 403', async () => {
    expect((await authReq(cusToken).get('/refunds')).status).toBe(403);
  });
  it('customer PUT /store-settings → 403', async () => {
    expect((await authReq(cusToken).put('/store-settings').send({})).status).toBe(403);
  });
  it('公开 GET /dishes → 200', async () => {
    expect((await api().get('/dishes')).status).toBe(200);
  });
});

describe('Dishes — 商家 CRUD', () => {
  let tok: string, catId: number, dishId: number;
  beforeAll(async () => { tok = await loginAs('manager'); });

  it('创建分类', async () => {
    const r = await authReq(tok).post('/dishes/categories').send({ name: `CAT_${Date.now()}` });
    expect(r.status).toBe(200); catId = r.body.id;
  });
  it('创建菜品', async () => {
    const r = await authReq(tok).post('/dishes').send({ name: `D_${Date.now()}`, price: '28', category_id: catId });
    expect(r.status).toBe(200); dishId = r.body.id;
  });
  it('改价格', async () => {
    const r = await authReq(tok).put(`/dishes/${dishId}`).send({ name: 'UP', price: '38', category_id: catId });
    expect(r.status).toBe(200);
  });
  it('下架上架', async () => {
    await authReq(tok).post(`/dishes/${dishId}/toggle`);
    const r = await authReq(tok).post(`/dishes/${dishId}/toggle`);
    expect(r.status).toBe(200);
  });
  it('删菜品', async () => {
    expect((await authReq(tok).delete(`/dishes/${dishId}`)).status).toBe(200);
  });
  it('删分类', async () => {
    expect((await authReq(tok).delete(`/dishes/categories/${catId}`)).status).toBe(200);
  });
});

describe('Tables — 商家 CRUD', () => {
  let tok: string, id: number;
  beforeAll(async () => { tok = await loginAs('manager'); });

  it('创建桌台', async () => {
    const r = await authReq(tok).post('/tables').send({ table_number: `T${Date.now() % 100000}`, capacity: 4 });
    expect(r.status).toBe(200); id = r.body.id;
  });
  it('列表', async () => { expect((await authReq(tok).get('/tables')).status).toBe(200); });
  it('看板', async () => { expect((await authReq(tok).get('/tables/board')).status).toBe(200); });
  it('二维码', async () => { expect((await authReq(tok).post(`/tables/${id}/qrcode`)).status).toBe(200); });
  it('删除', async () => { expect((await authReq(tok).delete(`/tables/${id}`)).status).toBe(200); });
});

describe('顾客流程', () => {
  let tok: string, orderId: number;
  beforeAll(async () => { tok = await loginAsCustomer(); });

  it('验证桌号', async () => { expect((await api().get('/tables/validate/1')).status).toBe(200); });
  it('浏览菜品', async () => {
    const r = await api().get('/dishes');
    expect(r.status).toBe(200);
  });
  it('提交订单', async () => {
    const dishes = await api().get('/dishes');
    const d = dishes.body.find((x: any) => x.is_available !== 0);
    if (!d) return;
    const r = await authReq(tok).post('/orders').send({
      table_id: 1, items: [{ dish_id: d.id, quantity: 2 }], order_type: 'dine_in',
      idempotency_key: `f_${Date.now()}`,
    });
    expect(r.status).toBe(200); orderId = r.body.id;
  });
  it('订单详情', async () => {
    if (!orderId) return;
    expect((await authReq(tok).get(`/orders/${orderId}`)).status).toBe(200);
  });
  it('加菜', async () => {
    if (!orderId) return;
    const dishes = await api().get('/dishes');
    const d = dishes.body.find((x: any) => x.is_available !== 0);
    if (!d) return;
    expect((await authReq(tok).post(`/orders/${orderId}/items`).send({ dish_id: d.id, quantity: 1 })).status).toBe(200);
  });
  it('幂等', async () => {
    const key = `idem_${Date.now()}`, dishes = await api().get('/dishes');
    const d = dishes.body.find((x: any) => x.is_available !== 0);
    if (!d) return;
    const p = { table_id: 1, items: [{ dish_id: d.id, quantity: 1 }], order_type: 'dine_in', idempotency_key: key };
    const r1 = await authReq(tok).post('/orders').send(p);
    const r2 = await authReq(tok).post('/orders').send(p);
    expect(r1.status).toBe(200); expect(r2.status).toBe(200);
    if (r1.body.id && r2.body.id) expect(r1.body.id).toBe(r2.body.id);
  });
});

describe('商家流程', () => {
  let tok: string;
  beforeAll(async () => { tok = await loginAs('owner'); });

  it('桌台列表', async () => { expect((await authReq(tok).get('/tables')).status).toBe(200); });
  it('看板', async () => { expect((await authReq(tok).get('/tables/board')).status).toBe(200); });
  it('订单分页', async () => {
    const r = await authReq(tok).get('/orders?page=1&page_size=5');
    expect(r.status).toBe(200);
  });
  it('按状态筛选', async () => {
    expect((await authReq(tok).get('/orders?status=submitted&page=1&page_size=5')).status).toBe(200);
  });
  it('结账', async () => {
    const orders = await authReq(tok).get('/orders?status=submitted&page=1&page_size=1');
    const oid = orders.body.data?.[0]?.id;
    if (!oid) return;
    const r = await authReq(tok).post(`/orders/${oid}/status`).send({ status: 'settled', idempotency_key: `s_${Date.now()}` });
    expect(r.status).toBe(200);
  });
  it('退款分页', async () => {
    expect((await authReq(tok).get('/refunds?page=1&page_size=5')).status).toBe(200);
  });
  it('统计概览', async () => {
    expect((await authReq(tok).get('/statistics/overview')).status).toBe(200);
  });
});
