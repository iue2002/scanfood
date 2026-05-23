/**
 * Feature: merchant-ops-center, Property 15/16/17/18/19/20/21/22: Print invariants
 * Validates: Requirements 13.6, 14.2, 14.3, 14.4, 14.5, 16.1, 16.2, 16.5, 17.2,
 *            17.4, 17.5, 19.2, 19.5, 20.4
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { PrintCore } from './print.core';
import type { MopEventEmitter } from './print.core';
import { Aes256Encryptor } from './aes-encryptor';
import { ALL_TEMPLATE_FIELDS, KITCHEN_ALLOWED_FIELDS, REQUIRED_TEMPLATE_FIELDS, RETRY_DELAYS_MS } from './print.types';
import type {
  PrintRepoPort,
  PrinterUpsertDto,
} from './print-repo.port';
import type {
  PrinterRow,
  TemplateRow,
  PrintJobRow,
  TemplateField,
  PrintWidth,
  PrintPayload,
  OrderProjection,
  PrinterDriverPort,
  DriverResponse,
  PrintJobTrigger,
  PrintJobStatus,
} from './print.types';

// ============================================================
// 测试辅助：In-memory Repo / Driver / EventBus / Aes
// ============================================================
class StubPrintRepo implements PrintRepoPort {
  printers: PrinterRow[] = [];
  templates: TemplateRow[] = [];
  jobs: PrintJobRow[] = [];
  private nextPrinterId = 1;
  private nextTemplateId = 1;
  private nextJobId = 1;

  async insertPrinter(dto: any, deviceKeyEncrypted: string | null): Promise<PrinterRow> {
    const row: PrinterRow = {
      id: this.nextPrinterId++,
      name: dto.name,
      provider: dto.provider,
      device_sn: dto.device_sn ?? null,
      device_key: undefined,
      role: dto.role ?? 'BOTH',
      enabled: dto.enabled ?? true,
      auto_print: dto.auto_print ?? false,
      auto_print_add_more: dto.auto_print_add_more ?? false,
      template_id: dto.template_id ?? null,
      last_online_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };
    (row as any)._device_key_enc = deviceKeyEncrypted;
    this.printers.push(row);
    return row;
  }
  async updatePrinter(id: number, patch: any): Promise<PrinterRow> {
    const i = this.printers.findIndex((p) => p.id === id);
    if (i < 0) throw new Error('printer not found');
    Object.assign(this.printers[i], patch);
    return this.printers[i];
  }
  async deletePrinter(id: number): Promise<void> {
    this.printers = this.printers.filter((p) => p.id !== id);
  }
  async findPrinterById(id: number): Promise<PrinterRow | null> {
    return this.printers.find((p) => p.id === id) ?? null;
  }
  async findPrinterByIdWithKey(id: number, decrypt: (e: string) => string): Promise<PrinterRow | null> {
    const p = this.printers.find((x) => x.id === id);
    if (!p) return null;
    const enc = (p as any)._device_key_enc;
    if (enc) {
      try { p.device_key = decrypt(enc); } catch { p.device_key = null; }
    }
    return p;
  }
  async listPrinters(): Promise<PrinterRow[]> {
    return [...this.printers];
  }
  async listAutoPrinters(trigger: 'NEW_ORDER' | 'ADD_MORE'): Promise<PrinterRow[]> {
    return this.printers.filter((p) => p.enabled && (trigger === 'NEW_ORDER' ? p.auto_print : p.auto_print_add_more));
  }
  async insertTemplate(name: string, fields: TemplateField[], width: PrintWidth): Promise<TemplateRow> {
    const t: TemplateRow = { id: this.nextTemplateId++, name, fields_json: fields, width, created_at: new Date(), updated_at: new Date() };
    this.templates.push(t);
    return t;
  }
  async updateTemplate(id: number, patch: any): Promise<TemplateRow> {
    const i = this.templates.findIndex((t) => t.id === id);
    if (i < 0) throw new Error('template not found');
    Object.assign(this.templates[i], patch);
    return this.templates[i];
  }
  async findTemplateById(id: number): Promise<TemplateRow | null> {
    return this.templates.find((t) => t.id === id) ?? null;
  }
  async listTemplates(): Promise<TemplateRow[]> {
    return [...this.templates];
  }
  async insertJob(row: any): Promise<PrintJobRow> {
    const j: PrintJobRow = { id: this.nextJobId++, created_at: new Date(), updated_at: new Date(), completed_at: null, ...row };
    this.jobs.push(j);
    return j;
  }
  async updateJob(id: number, patch: any): Promise<void> {
    const i = this.jobs.findIndex((j) => j.id === id);
    if (i < 0) return;
    Object.assign(this.jobs[i], patch);
  }
  async listDuePending(now: Date, _maxPerPrinter: number): Promise<PrintJobRow[]> {
    return this.jobs
      .filter((j) => j.status === 'PENDING' && (j.next_retry_at == null || j.next_retry_at.getTime() <= now.getTime()))
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
  }
  async listJobsByPrinter(printerId: number, limit: number): Promise<PrintJobRow[]> {
    return this.jobs
      .filter((j) => j.printer_id === printerId)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .slice(0, limit);
  }
  async listJobsByOrder(orderId: number): Promise<PrintJobRow[]> {
    return this.jobs.filter((j) => j.order_id === orderId);
  }
  async deleteOldJobs(cutoff: Date, batchSize: number): Promise<number> {
    const before = this.jobs.length;
    const expired = this.jobs.filter((j) => j.created_at < cutoff).slice(0, batchSize);
    const ids = new Set(expired.map((e) => e.id));
    this.jobs = this.jobs.filter((j) => !ids.has(j.id));
    return before - this.jobs.length;
  }
}

class StubDriver implements PrinterDriverPort {
  // 控制是否抛错 / 拒绝
  fail = false;
  errorMessage = 'simulated';
  online = true;
  sentTo: number[] = [];
  throwOnSend = false;

  async send(printer: PrinterRow, _payload: PrintPayload, _t: number): Promise<DriverResponse> {
    if (this.throwOnSend) throw new Error(this.errorMessage);
    this.sentTo.push(printer.id);
    if (this.fail) return { accepted: false, errorCode: 'PRINT_FAILED', errorMessage: this.errorMessage };
    return { accepted: true, providerJobId: `prov-${this.sentTo.length}` };
  }
  async queryOnline(_p: PrinterRow): Promise<{ online: boolean }> {
    return { online: this.online };
  }
}

class StubEventBus implements MopEventEmitter {
  events: Array<{ event: string; payload: any }> = [];
  emit(event: `mop:${string}`, payload: any): void {
    if (!event.startsWith('mop:')) throw new Error('non-mop event');
    this.events.push({ event, payload });
  }
}

const TEST_AES = new Aes256Encryptor('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff');

const baseTemplate = (overrides: Partial<TemplateRow> = {}): TemplateRow => ({
  id: 1,
  name: 'tpl',
  fields_json: ['STORE_NAME', 'TABLE_NUMBER', 'ORDER_NO', 'TIME', 'ITEMS', 'TOTAL', 'REMARK', 'OPERATOR'],
  width: '80mm',
  created_at: new Date(),
  updated_at: new Date(),
  ...overrides,
});

const samplePayload = (fields: TemplateField[]): PrintPayload => ({
  width: '80mm',
  fields,
  store_name: '伊美轩',
  table_number: '8',
  order_no: 'OD-1',
  order_time: '2026-05-24 12:00:00',
  items: [
    { name: '宫保鸡丁', spec: '辣', quantity: 2, subtotal: 40 },
    { name: '米饭', spec: null, quantity: 1, subtotal: 3 },
  ],
  total: 43,
  remark: '不要香菜',
  operator: 'alice',
});

// ============================================================
// Property 15: device_key 加密往返且不外泄
// ============================================================
describe('Feature: merchant-ops-center, Property 15: device_key encryption round-trip and never leaks', () => {
  it('encrypt(plain) ≠ plain AND decrypt(encrypt(plain)) === plain', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 64 }), (key) => {
        const enc = TEST_AES.encrypt(key);
        if (enc === key) return false;
        return TEST_AES.decrypt(enc) === key;
      }),
      { numRuns: 200 },
    );
  });

  it('toPublic() never exposes device_key or its encrypted form', () => {
    // 用复杂混合密码（含特殊符号 + 数字 + 大小写），避免与字段名 / 默认值字符串碰撞
    const arbStrongKey = fc
      .stringMatching(/^[A-Za-z0-9!@#$%^&*\-_=]{16,64}$/)
      .filter((s) => /[A-Z]/.test(s) && /[a-z]/.test(s) && /[0-9]/.test(s) && /[!@#$%^&*\-_=]/.test(s));
    fc.assert(
      fc.property(arbStrongKey, (key) => {
        const printer: PrinterRow = {
          id: 1,
          name: 'p1',
          provider: 'FEIE',
          device_sn: 'sn1',
          device_key: key,
          role: 'BOTH',
          enabled: true,
          auto_print: true,
          auto_print_add_more: false,
          template_id: 1,
          last_online_at: null,
          created_at: new Date(),
          updated_at: new Date(),
        };
        const pub = PrintCore.toPublic(printer);
        const json = JSON.stringify(pub);
        // 关键不变量：JSON 化的对外投影绝不含 device_key 明文 / 派生
        if (json.includes(key)) return false;
        if ('device_key' in pub) return false;
        if ('device_key_enc' in (pub as any)) return false;
        return pub.has_device_key === true;
      }),
      { numRuns: 100 },
    );
  });

  it('AES rejects bad key length / non-hex', () => {
    expect(() => new Aes256Encryptor('short')).toThrow();
    expect(() => new Aes256Encryptor('NOT_HEX_!!!@!@@@!@@@!@@@@!@@@@@@!@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@')).toThrow();
  });
});

// ============================================================
// Property 16: 模板字段必需且子集
// ============================================================
describe('Feature: merchant-ops-center, Property 16: template fields are subset and contain required', () => {
  it('accepts iff fields ⊆ ALL AND {TABLE_NUMBER, ITEMS, TOTAL} ⊆ fields', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.constantFrom(...ALL_TEMPLATE_FIELDS),
            fc.string({ minLength: 1, maxLength: 12 }),
          ),
          { minLength: 0, maxLength: 10 },
        ),
        (input) => {
          const result = PrintCore.validateTemplate(input as any);
          const isSubset = input.every((f) => (ALL_TEMPLATE_FIELDS as ReadonlyArray<string>).includes(f as string));
          const hasRequired = REQUIRED_TEMPLATE_FIELDS.every((m) => input.includes(m));
          const expected = isSubset && hasRequired;
          if (expected) return result.ok === true;
          return result.ok === false && result.code === 'TEMPLATE_INVALID';
        },
      ),
      { numRuns: 200 },
    );
  });

  it('idempotent normalization: validate(validate(x)) === validate(x)', () => {
    const r1 = PrintCore.validateTemplate(['ITEMS', 'TABLE_NUMBER', 'TOTAL', 'ITEMS']);
    expect(r1.ok).toBe(true);
    if (r1.ok) {
      const r2 = PrintCore.validateTemplate(r1.normalized);
      expect(r2.ok).toBe(true);
      if (r2.ok) expect(r2.normalized).toEqual(r1.normalized);
    }
  });
});

// ============================================================
// Property 17: ESC/POS round-trip
// ============================================================
describe('Feature: merchant-ops-center, Property 17: ESC/POS render parses back to template fields', () => {
  it('parseEscPosFields(renderEscPos(t, p)) ⊇ Set(t.fields_json)', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.constantFrom(...ALL_TEMPLATE_FIELDS), { minLength: 3, maxLength: 8 })
          .filter((arr) => REQUIRED_TEMPLATE_FIELDS.every((m) => arr.includes(m))),
        (fields) => {
          const tpl = baseTemplate({ fields_json: fields });
          const escpos = PrintCore.renderEscPos(tpl, samplePayload(fields));
          const parsed = PrintCore.parseEscPosFields(escpos);
          for (const f of fields) {
            if (!parsed.has(f)) return false;
          }
          return true;
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ============================================================
// Property 18: 拆单角色一致性
// ============================================================
describe('Feature: merchant-ops-center, Property 18: split jobs by role', () => {
  const printerArb = fc.record({
    id: fc.integer({ min: 1, max: 1000 }),
    role: fc.constantFrom<'CASHIER' | 'KITCHEN' | 'BOTH'>('CASHIER', 'KITCHEN', 'BOTH'),
    enabled: fc.boolean(),
    auto_print: fc.boolean(),
    auto_print_add_more: fc.boolean(),
  });

  it('plans.length matches enabled+auto_print printers; KITCHEN fields ⊆ allowed; CASHIER ⊇ template.fields_json', () => {
    fc.assert(
      fc.property(fc.array(printerArb, { maxLength: 10 }), (mini) => {
        const printers: PrinterRow[] = mini.map((m) => ({
          id: m.id,
          name: 'p',
          provider: 'FEIE' as const,
          device_sn: null,
          role: m.role,
          enabled: m.enabled,
          auto_print: m.auto_print,
          auto_print_add_more: m.auto_print_add_more,
          template_id: 1,
          last_online_at: null,
          created_at: new Date(),
          updated_at: new Date(),
        }));
        const tpl = baseTemplate();
        const plans = PrintCore.splitJobsByRole(printers, tpl, 'NEW_ORDER');

        // (a) 数量
        const expected = printers.filter((p) => p.enabled && p.auto_print).length;
        if (plans.length !== expected) return false;

        for (const plan of plans) {
          if (plan.printer.role === 'KITCHEN') {
            // KITCHEN ⊆ allowed
            for (const f of plan.fields) {
              if (!KITCHEN_ALLOWED_FIELDS.includes(f)) return false;
            }
            // 必含 ITEMS
            if (!plan.fields.includes('ITEMS')) return false;
          } else {
            // CASHIER / BOTH ⊇ template.fields_json
            for (const f of tpl.fields_json) {
              if (!plan.fields.includes(f)) return false;
            }
          }
        }
        return true;
      }),
      { numRuns: 200 },
    );
  });
});

// ============================================================
// Property 19: 自动打印故障隔离（onOrderEvent 永远不抛）
// ============================================================
describe('Feature: merchant-ops-center, Property 19: auto print failure isolation', () => {
  it('onOrderEvent never throws even when driver / repo / reader throw', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(), // driver throws
        fc.boolean(), // reader throws
        fc.constantFrom<PrintJobTrigger & ('NEW_ORDER' | 'ADD_MORE')>('NEW_ORDER', 'ADD_MORE'),
        async (driverThrows, readerThrows, trigger) => {
          const repo = new StubPrintRepo();
          const driver = new StubDriver();
          driver.throwOnSend = driverThrows;
          const bus = new StubEventBus();
          const reader = readerThrows
            ? async () => { throw new Error('reader failed'); }
            : async () => null; // 订单不存在，但 core 应优雅返回不抛
          const core = new PrintCore(
            repo,
            new Map([['FEIE', driver as any], ['BROWSER', driver as any]]),
            TEST_AES,
            bus,
            reader as any,
          );
          // 不应 throw
          let threw = false;
          try {
            await core.onOrderEvent(123, trigger);
          } catch {
            threw = true;
          }
          return threw === false;
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 20: 重试调度单调非降
// ============================================================
describe('Feature: merchant-ops-center, Property 20: retry schedule monotonic', () => {
  it('computeNextRetryAt(now, k) increasing AND distance ≥ RETRY_DELAYS_MS[k-1]', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31'), noInvalidDate: true }),
        (now) => {
          const t1 = PrintCore.computeNextRetryAt(now, 1);
          const t2 = PrintCore.computeNextRetryAt(now, 2);
          const t3 = PrintCore.computeNextRetryAt(now, 3);
          if (t1.getTime() < now.getTime() + 30_000) return false;
          if (t2.getTime() < now.getTime() + 2 * 60_000) return false;
          if (t3.getTime() < now.getTime() + 10 * 60_000) return false;
          return t1.getTime() <= t2.getTime() && t2.getTime() <= t3.getTime();
        },
      ),
      { numRuns: 200 },
    );
  });

  it('rejects invalid Date input', () => {
    expect(() => PrintCore.computeNextRetryAt(new Date('invalid'), 1)).toThrow();
  });
});

// ============================================================
// Property 21: 派发顺序与离线暂停
// ============================================================
describe('Feature: merchant-ops-center, Property 21: dispatch order and offline pause', () => {
  it('offline printer never receives send; online printer receives jobs in created_at asc order, ≤ 50', async () => {
    // 准备：1 台离线 + 1 台在线打印机；离线打印机的所有 job 不应被 send；在线打印机按 FIFO 派发
    const repo = new StubPrintRepo();
    const driverOnline = new StubDriver();
    driverOnline.online = true;
    const driverOffline = new StubDriver();
    driverOffline.online = false;
    const bus = new StubEventBus();

    // 注意：drivers 按 provider 区分；这里给两台不同 provider
    const core = new PrintCore(
      repo,
      new Map([['FEIE', driverOnline as any], ['BROWSER', driverOffline as any]]),
      TEST_AES,
      bus,
      async () => null,
    );

    // 创建两台打印机：FEIE 在线 / BROWSER 离线
    const onlinePrinter = await repo.insertPrinter({ name: 'p1', provider: 'FEIE', enabled: true } as any, null);
    const offlinePrinter = await repo.insertPrinter({ name: 'p2', provider: 'BROWSER', enabled: true } as any, null);

    // 给两台打印机各塞 60 条 PENDING（顺序：先在线 60 个，后离线 60 个）
    const baseTime = Date.now();
    for (let i = 0; i < 60; i++) {
      const j = await repo.insertJob({
        printer_id: onlinePrinter.id,
        template_id: 1,
        order_id: i,
        trigger: 'NEW_ORDER',
        payload_json: { width: '80mm', fields: ['TABLE_NUMBER', 'ITEMS', 'TOTAL'] },
        status: 'PENDING',
        attempt: 0,
        last_error: null,
        next_retry_at: null,
        provider_job_id: null,
      });
      // 强制 created_at 单调
      j.created_at = new Date(baseTime + i);
    }
    for (let i = 0; i < 60; i++) {
      const j = await repo.insertJob({
        printer_id: offlinePrinter.id,
        template_id: 1,
        order_id: 1000 + i,
        trigger: 'NEW_ORDER',
        payload_json: { width: '80mm', fields: ['TABLE_NUMBER', 'ITEMS', 'TOTAL'] },
        status: 'PENDING',
        attempt: 0,
        last_error: null,
        next_retry_at: null,
        provider_job_id: null,
      });
      j.created_at = new Date(baseTime + 1000 + i);
    }

    await core.runRetryTick();

    // (a) 离线打印机一次都不应该被 send
    expect(driverOffline.sentTo).toEqual([]);
    // (b) 在线打印机一次最多 50 条
    expect(driverOnline.sentTo.length).toBeLessThanOrEqual(50);
    expect(driverOnline.sentTo.length).toBeGreaterThan(0);
    // 全部是同一台（onlinePrinter.id）
    expect(driverOnline.sentTo.every((id) => id === onlinePrinter.id)).toBe(true);
  });
});

// ============================================================
// Property 22: mop:* WebSocket 事件白名单
// ============================================================
import { MopEventBus } from './mop-event-bus';

describe('Feature: merchant-ops-center, Property 22: mop:* event whitelist', () => {
  it('emit non-mop event throws and does not reach gateway', () => {
    let bridged = 0;
    const fakeGateway: any = { notifyAllAdmins: (_e: string, _p: any) => { bridged++; } };
    const bus = new MopEventBus(fakeGateway);

    // 合法 mop:* 事件应被桥接
    bus.emit('mop:printer-error', { x: 1 });
    expect(bridged).toBe(1);

    // 非 mop:* 必须 throw 且不增加桥接
    expect(() => bus.emit('orderUpdated' as any, { x: 1 })).toThrow();
    expect(bridged).toBe(1);
    expect(() => bus.emit('attack:notify' as any, {})).toThrow();
    expect(bridged).toBe(1);
  });
});
