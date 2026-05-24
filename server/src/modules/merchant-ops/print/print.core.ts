/**
 * PrintCore：打印领域核心
 *
 * 静态规则方法（PBT 友好）：
 *   - validateTemplate（Property 16）
 *   - renderEscPos / parseEscPosFields（Property 17 ESC/POS round-trip）
 *   - splitJobsByRole（Property 18 拆单）
 *   - computeNextRetryAt（Property 20 重试单调）
 *
 * 业务方法（依赖 RepoPort + DriverPort）：
 *   - createOrUpdatePrinter / listPrinters（Property 15: 不外泄 device_key）
 *   - testPrint（R15: 5s timeout，结果走审计）
 *   - planForOrder + enqueueJobsForOrder（自动打印 NEW_ORDER / ADD_MORE）
 *   - runRetryTick（重试调度，cron 30s）
 *   - onOrderEvent（Property 19: 永远不抛错给 OrdersGateway）
 *
 * 异常隔离（R19.5）：core 内部所有 driver / repo 调用都被 try/catch；
 * 失败转化为 print_jobs.last_error + mop:printer-error 事件。
 */
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  PrintRepoPort,
  PrinterUpsertDto,
} from './print-repo.port';
import type {
  PrinterRow,
  TemplateRow,
  PrintJobRow,
  PrinterPublic,
  TemplateField,
  PrintWidth,
  PrintPlan,
  PrintPayload,
  OrderProjection,
  PrinterDriverPort,
  DriverResponse,
  PrintJobTrigger,
} from './print.types';
import {
  ALL_TEMPLATE_FIELDS,
  KITCHEN_ALLOWED_FIELDS,
  REQUIRED_TEMPLATE_FIELDS,
  RETRY_DELAYS_MS,
  RETRY_TICK_BATCH_PER_PRINTER,
  SEND_TIMEOUT_MS,
  TEST_PRINT_TIMEOUT_MS,
} from './print.types';
import type { Aes256Encryptor } from './aes-encryptor';

/** ESC/POS 渲染时使用的字段标记（解析时回读） */
const FIELD_MARKERS: Record<TemplateField, string> = {
  STORE_NAME: 'STORE',
  TABLE_NUMBER: 'TABLE',
  ITEMS: 'ITEMS',
  TOTAL: 'TOTAL',
  TIME: 'TIME',
  ORDER_NO: 'ORDER',
  REMARK: 'REMARK',
  OPERATOR: 'OP',
};

/** 反向映射：marker 行首 → field */
const MARKER_TO_FIELD: Record<string, TemplateField> = Object.fromEntries(
  Object.entries(FIELD_MARKERS).map(([k, v]) => [v, k as TemplateField]),
);

/** 用于读取 mop:* WS 事件投放接口 */
export interface MopEventEmitter {
  emit(event: `mop:${string}`, payload: any): void;
}

@Injectable()
export class PrintCore {
  private readonly logger = new Logger(PrintCore.name);

  constructor(
    private readonly repo: PrintRepoPort,
    private readonly drivers: Map<string, PrinterDriverPort>, // key=provider
    private readonly aes: Aes256Encryptor,
    private readonly emitter: MopEventEmitter,
    private readonly readOrder: (orderId: number) => Promise<OrderProjection | null>,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  // ============================================================
  // 静态规则
  // ============================================================

  /**
   * Property 16：模板字段必需且子集
   */
  static validateTemplate(fields: TemplateField[] | unknown):
    | { ok: true; normalized: TemplateField[] }
    | { ok: false; code: 'TEMPLATE_INVALID'; reason: string }
  {
    if (!Array.isArray(fields)) {
      return { ok: false, code: 'TEMPLATE_INVALID', reason: 'fields 必须是数组' };
    }
    const allowed = new Set<string>(ALL_TEMPLATE_FIELDS);
    for (const f of fields) {
      if (typeof f !== 'string' || !allowed.has(f)) {
        return { ok: false, code: 'TEMPLATE_INVALID', reason: `字段非法：${JSON.stringify(f)}` };
      }
    }
    const set = new Set<TemplateField>(fields as TemplateField[]);
    for (const must of REQUIRED_TEMPLATE_FIELDS) {
      if (!set.has(must)) {
        return { ok: false, code: 'TEMPLATE_INVALID', reason: `缺少必需字段 ${must}` };
      }
    }
    // 去重 + 按固定顺序
    const ordered = ALL_TEMPLATE_FIELDS.filter((f) => set.has(f));
    return { ok: true, normalized: ordered };
  }

  /**
   * Property 17：ESC/POS 渲染（与 parseEscPosFields 互逆）
   * 渲染策略：每个字段输出一段以 `===<MARKER>===` 起头的小节。
   * 例如 STORE_NAME 字段渲染为：
   *   ===STORE===
   *   伊美轩
   * ITEMS 字段渲染为：
   *   ===ITEMS===
   *   宫保鸡丁(辣) x2  ¥40.00
   *   米饭 x1  ¥3.00
   */
  static renderEscPos(template: TemplateRow, payload: PrintPayload): string {
    const lines: string[] = [];
    const sep = template.width === '58mm' ? '----------------' : '--------------------------------';
    lines.push(sep);

    // 严格按 fields_json 中的字段顺序输出
    for (const field of template.fields_json) {
      lines.push(`===${FIELD_MARKERS[field]}===`);
      switch (field) {
        case 'STORE_NAME':
          lines.push(payload.store_name ?? '');
          break;
        case 'TABLE_NUMBER':
          lines.push(`桌号：${payload.table_number ?? '-'}`);
          break;
        case 'ORDER_NO':
          lines.push(`订单号：${payload.order_no ?? '-'}`);
          break;
        case 'TIME':
          lines.push(`时间：${payload.order_time ?? '-'}`);
          break;
        case 'OPERATOR':
          lines.push(`操作员：${payload.operator ?? '-'}`);
          break;
        case 'REMARK':
          lines.push(`备注：${payload.remark ?? '-'}`);
          break;
        case 'ITEMS': {
          const items = payload.items ?? [];
          if (items.length === 0) {
            lines.push('（无菜品）');
          } else {
            for (const it of items) {
              const display = it.spec ? `${it.name}(${it.spec})` : it.name;
              const subtotal = typeof it.subtotal === 'number' ? `¥${it.subtotal.toFixed(2)}` : '';
              lines.push(`${display} x${it.quantity}  ${subtotal}`.trim());
            }
          }
          break;
        }
        case 'TOTAL':
          lines.push(`合计：¥${(payload.total ?? 0).toFixed(2)}`);
          break;
      }
    }
    lines.push(sep);
    lines.push(''); // 留白便于切纸
    return lines.join('\n');
  }

  /**
   * Property 17 round-trip：从 ESC/POS 文本中解析出现的字段集合
   */
  static parseEscPosFields(escposText: string): Set<TemplateField> {
    const fields = new Set<TemplateField>();
    const re = /^===([A-Z_]+)===$/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(escposText)) !== null) {
      const field = MARKER_TO_FIELD[m[1]];
      if (field) fields.add(field);
    }
    return fields;
  }

  /**
   * 渲染 HTML 预览（用于浏览器打印 / preview 接口）
   */
  static renderHtml(template: TemplateRow, payload: PrintPayload): string {
    const widthCss = template.width === '58mm' ? '58mm' : '80mm';
    const blocks: string[] = [];
    for (const field of template.fields_json) {
      switch (field) {
        case 'STORE_NAME':
          blocks.push(`<div class="store">${escapeHtml(payload.store_name ?? '')}</div>`);
          break;
        case 'TABLE_NUMBER':
          blocks.push(`<div class="row"><span>桌号</span><b>${escapeHtml(payload.table_number ?? '-')}</b></div>`);
          break;
        case 'ORDER_NO':
          blocks.push(`<div class="row"><span>订单号</span><b>${escapeHtml(payload.order_no ?? '-')}</b></div>`);
          break;
        case 'TIME':
          blocks.push(`<div class="row"><span>时间</span><b>${escapeHtml(payload.order_time ?? '-')}</b></div>`);
          break;
        case 'OPERATOR':
          blocks.push(`<div class="row"><span>操作员</span><b>${escapeHtml(payload.operator ?? '-')}</b></div>`);
          break;
        case 'REMARK':
          blocks.push(`<div class="row"><span>备注</span><b>${escapeHtml(payload.remark ?? '-')}</b></div>`);
          break;
        case 'ITEMS': {
          const items = payload.items ?? [];
          const rows = items.length === 0
            ? `<div class="empty">（无菜品）</div>`
            : items.map((it) => {
              const name = it.spec ? `${it.name}(${it.spec})` : it.name;
              const sub = typeof it.subtotal === 'number' ? `¥${it.subtotal.toFixed(2)}` : '';
              return `<div class="item"><span>${escapeHtml(name)} x${it.quantity}</span><b>${sub}</b></div>`;
            }).join('');
          blocks.push(`<div class="items"><div class="hr"></div>${rows}<div class="hr"></div></div>`);
          break;
        }
        case 'TOTAL':
          blocks.push(`<div class="row total"><span>合计</span><b>¥${(payload.total ?? 0).toFixed(2)}</b></div>`);
          break;
      }
    }
    return `<div class="ticket" style="width:${widthCss}">${blocks.join('')}</div>`;
  }

  /**
   * Property 18：按角色拆单
   * - 仅返回 enabled+auto_print 的打印机
   * - CASHIER 用模板原 fields；KITCHEN 投影到 KITCHEN_ALLOWED_FIELDS（保留 ITEMS）
   * - BOTH 视同 CASHIER（全票）
   */
  static splitJobsByRole(
    printers: PrinterRow[],
    template: TemplateRow,
    triggerFilter?: 'NEW_ORDER' | 'ADD_MORE',
  ): PrintPlan[] {
    const out: PrintPlan[] = [];
    for (const p of printers) {
      if (!p.enabled) continue;
      if (triggerFilter === 'NEW_ORDER' && !p.auto_print) continue;
      if (triggerFilter === 'ADD_MORE' && !p.auto_print_add_more) continue;

      let fields: TemplateField[];
      if (p.role === 'KITCHEN') {
        fields = template.fields_json.filter((f) => KITCHEN_ALLOWED_FIELDS.includes(f));
        if (!fields.includes('ITEMS')) fields = [...fields, 'ITEMS'];
      } else {
        // CASHIER / BOTH：全票
        fields = [...template.fields_json];
      }
      out.push({ printer: p, template, fields });
    }
    return out;
  }

  /**
   * Property 20：重试时间序列单调非降
   *  attempt=1 → now + 30s
   *  attempt=2 → now + 30s + (2min - 30s) = now + 2min
   *  attempt=3 → now + 2min + (10min - 2min) = now + 10min
   */
  static computeNextRetryAt(now: Date, attempt: 1 | 2 | 3): Date {
    if (!(now instanceof Date) || isNaN(now.getTime())) {
      throw new Error('computeNextRetryAt: now 必须是合法 Date');
    }
    const idx = Math.min(Math.max(attempt, 1), 3) - 1;
    return new Date(now.getTime() + RETRY_DELAYS_MS[idx]);
  }

  /**
   * Property 15.c：把 PrinterRow 投影成对外 PrinterPublic（绝不含 device_key）
   */
  static toPublic(p: PrinterRow, online?: boolean): PrinterPublic {
    return {
      id: p.id,
      name: p.name,
      provider: p.provider,
      device_sn: p.device_sn ?? null,
      has_device_key: !!(p.device_key && p.device_key.length > 0),
      role: p.role,
      enabled: p.enabled,
      auto_print: p.auto_print,
      auto_print_add_more: p.auto_print_add_more,
      template_id: p.template_id ?? null,
      last_online_at: p.last_online_at ?? null,
      online,
      created_at: p.created_at,
      updated_at: p.updated_at,
    };
  }

  // ============================================================
  // 业务方法
  // ============================================================

  async createPrinter(dto: PrinterUpsertDto): Promise<PrinterRow> {
    if (!dto.name || dto.name.length === 0) {
      throw new BadRequestException({ code: 'PRINTER_INVALID', msg: '名称不能为空' });
    }
    if (dto.provider === 'FEIE') {
      if (!dto.device_sn) throw new BadRequestException({ code: 'PRINTER_INVALID', msg: '飞鹅打印机必须填 device_sn' });
      if (!dto.device_key_plain) throw new BadRequestException({ code: 'PRINTER_INVALID', msg: '飞鹅打印机必须填 device_key' });
    }
    let deviceKeyEnc: string | null = null;
    if (dto.device_key_plain) {
      deviceKeyEnc = this.aes.encrypt(dto.device_key_plain);
    }
    return await this.repo.insertPrinter(dto, deviceKeyEnc);
  }

  async updatePrinter(id: number, dto: PrinterUpsertDto): Promise<PrinterRow> {
    const cur = await this.repo.findPrinterById(id);
    if (!cur) throw new NotFoundException({ code: 'PRINTER_NOT_FOUND', msg: '打印机不存在' });
    const patch: any = { ...dto };
    if (dto.device_key_plain !== undefined) {
      patch.device_key_enc = dto.device_key_plain ? this.aes.encrypt(dto.device_key_plain) : null;
      delete patch.device_key_plain;
    } else {
      delete patch.device_key_plain;
    }
    return await this.repo.updatePrinter(id, patch);
  }

  async deletePrinter(id: number): Promise<void> {
    const cur = await this.repo.findPrinterById(id);
    if (!cur) throw new NotFoundException({ code: 'PRINTER_NOT_FOUND', msg: '打印机不存在' });
    await this.repo.deletePrinter(id);
  }

  async listPrintersWithStatus(): Promise<PrinterPublic[]> {
    const rows = await this.repo.listPrinters();
    const result: PrinterPublic[] = [];
    for (const p of rows) {
      // 在线状态查询失败默认 false
      let online: boolean | undefined;
      const driver = this.drivers.get(p.provider);
      if (driver) {
        try {
          // 加密版给 driver；driver 自己做超时
          const r = await driver.queryOnline(p);
          online = r.online;
        } catch (err) {
          this.logger.warn(`[print] queryOnline failed: ${(err as Error).message}`);
          online = undefined;
        }
      }
      result.push(PrintCore.toPublic(p, online));
    }
    return result;
  }

  async getTemplate(id: number): Promise<TemplateRow> {
    const t = await this.repo.findTemplateById(id);
    if (!t) throw new NotFoundException({ code: 'TEMPLATE_NOT_FOUND', msg: '模板不存在' });
    return t;
  }

  async listTemplates(): Promise<TemplateRow[]> {
    return await this.repo.listTemplates();
  }

  async createTemplate(name: string, fields: TemplateField[], width: PrintWidth): Promise<TemplateRow> {
    const v = PrintCore.validateTemplate(fields);
    if (!v.ok) throw new BadRequestException({ code: v.code, msg: v.reason });
    return await this.repo.insertTemplate(name, v.normalized, width);
  }

  async updateTemplate(id: number, patch: Partial<{ name: string; fields_json: TemplateField[]; width: PrintWidth }>): Promise<TemplateRow> {
    const cur = await this.repo.findTemplateById(id);
    if (!cur) throw new NotFoundException({ code: 'TEMPLATE_NOT_FOUND', msg: '模板不存在' });
    let normalized = patch.fields_json;
    if (patch.fields_json !== undefined) {
      const v = PrintCore.validateTemplate(patch.fields_json);
      if (!v.ok) throw new BadRequestException({ code: v.code, msg: v.reason });
      normalized = v.normalized;
    }
    return await this.repo.updateTemplate(id, {
      name: patch.name,
      width: patch.width,
      fields_json: normalized,
    });
  }

  /**
   * 删除模板：DB FK 已配 ON DELETE SET NULL，引用模板的打印机/任务自动解引用
   * 安全保障：禁止删除最后一个模板（避免新打印机找不到默认模板）
   * 禁止删除 id=1 / id=2 系统默认模板（业务规则，UI 也禁止）
   */
  async deleteTemplate(id: number): Promise<void> {
    if (id === 1 || id === 2) {
      throw new BadRequestException({ code: 'TEMPLATE_PROTECTED', msg: '系统默认模板不能删除' });
    }
    const cur = await this.repo.findTemplateById(id);
    if (!cur) throw new NotFoundException({ code: 'TEMPLATE_NOT_FOUND', msg: '模板不存在' });
    const total = (await this.repo.listTemplates()).length;
    if (total <= 1) {
      throw new BadRequestException({ code: 'TEMPLATE_LAST_ONE', msg: '至少保留一个模板' });
    }
    await this.repo.deleteTemplate(id);
  }

  /**
   * R14.4：模板预览（生成 ESC/POS + HTML）
   */
  async previewTemplate(id: number, sample?: PrintPayload): Promise<{ escpos: string; html: string }> {
    const tpl = await this.getTemplate(id);
    const payload: PrintPayload = sample ?? this.makeSamplePayload(tpl);
    return {
      escpos: PrintCore.renderEscPos(tpl, { ...payload, fields: tpl.fields_json, width: tpl.width }),
      html: PrintCore.renderHtml(tpl, payload),
    };
  }

  private makeSamplePayload(tpl: TemplateRow): PrintPayload {
    return {
      width: tpl.width,
      fields: tpl.fields_json,
      store_name: '伊美轩',
      table_number: '8',
      order_no: 'OD20260524-001',
      order_time: this.fmtDateTime(this.clock()),
      items: [
        { name: '宫保鸡丁', spec: '辣', quantity: 2, subtotal: 40 },
        { name: '米饭', spec: null, quantity: 1, subtotal: 3 },
      ],
      total: 43,
      remark: '不要香菜',
      operator: '示例操作员',
    };
  }

  /**
   * R15：试打印
   * 5 秒 timeout，结果不论成败都返回 controller，由 controller 写审计
   */
  async testPrint(printerId: number): Promise<{ accepted: boolean; providerJobId?: string | null; errorCode?: string | null; templateId: number | null }> {
    const printer = await this.repo.findPrinterByIdWithKey(printerId, (enc) => this.aes.decrypt(enc));
    if (!printer) throw new NotFoundException({ code: 'PRINTER_NOT_FOUND', msg: '打印机不存在' });
    if (printer.provider === 'FEIE' && printer.device_key === null && (printer.device_sn || true)) {
      // 解密失败
      throw new BadRequestException({ code: 'DEVICE_KEY_CORRUPTED', msg: 'device_key 解密失败，请重新设置' });
    }
    const tplId = printer.template_id ?? 1;
    const tpl = await this.repo.findTemplateById(tplId);
    if (!tpl) throw new NotFoundException({ code: 'TEMPLATE_NOT_FOUND', msg: '默认模板不存在' });
    const payload: PrintPayload = {
      ...this.makeSamplePayload(tpl),
    };

    const driver = this.drivers.get(printer.provider);
    if (!driver) {
      return { accepted: false, errorCode: 'DRIVER_UNAVAILABLE', templateId: tplId };
    }
    try {
      const resp = await driver.send(printer, payload, TEST_PRINT_TIMEOUT_MS);
      return { accepted: resp.accepted, providerJobId: resp.providerJobId ?? null, errorCode: resp.errorCode ?? null, templateId: tplId };
    } catch (err) {
      const msg = (err as Error).message || 'unknown';
      // R15.3：超时也要把任务推入重试队列（业务侧实现：试打印失败不入队，避免污染；可由 controller 选择是否要补打）
      return { accepted: false, errorCode: msg.includes('timeout') ? 'UPSTREAM_TIMEOUT' : 'PRINT_FAILED', templateId: tplId };
    }
  }

  /**
   * 自动打印入口（订单事件触发）
   * Property 19：永远不抛错给调用者；失败转化为 print_jobs.last_error + mop:printer-error
   */
  async onOrderEvent(orderId: number, trigger: 'NEW_ORDER' | 'ADD_MORE'): Promise<void> {
    try {
      const order = await this.readOrder(orderId);
      if (!order) {
        this.logger.warn(`[print] order ${orderId} not found, skip auto print`);
        return;
      }
      const printers = await this.repo.listAutoPrinters(trigger);
      if (printers.length === 0) return;

      // 默认模板：每个打印机 template_id；缺省用 id=1（默认全票）/ id=2（后厨简化）
      for (const p of printers) {
        await this.enqueueJobForPrinter(p, order, trigger).catch((err) => {
          this.logger.error(`[print] enqueue failed for printer ${p.id}: ${(err as Error).message}`);
        });
      }
    } catch (err) {
      // R19.5 / Property 19：core 边界吞错误
      this.logger.error(`[print] onOrderEvent error: ${(err as Error).message}`);
    }
  }

  private async enqueueJobForPrinter(
    printer: PrinterRow,
    order: OrderProjection,
    trigger: PrintJobTrigger,
  ): Promise<PrintJobRow> {
    let templateId = printer.template_id;
    if (!templateId) {
      // 角色默认模板：KITCHEN→2，其余→1
      templateId = printer.role === 'KITCHEN' ? 2 : 1;
    }
    const tpl = await this.repo.findTemplateById(templateId) ?? await this.repo.findTemplateById(1);
    if (!tpl) {
      throw new Error('no template available');
    }
    // 角色拆字段
    const plans = PrintCore.splitJobsByRole([printer], tpl);
    const plan = plans[0];
    const fields = plan ? plan.fields : tpl.fields_json;
    const payload: PrintPayload = {
      width: tpl.width,
      fields,
      store_name: order.store_name,
      table_number: order.table_number,
      order_no: order.order_no,
      order_time: this.fmtDateTime(order.created_at),
      items: order.items.map((it) => ({ name: it.name, quantity: it.quantity, spec: it.spec, subtotal: it.subtotal })),
      total: order.total_amount,
      remark: order.remark,
      operator: order.operator,
    };
    return await this.repo.insertJob({
      printer_id: printer.id,
      template_id: tpl.id,
      order_id: order.order_id,
      trigger,
      payload_json: payload,
      status: 'PENDING',
      attempt: 0,
      last_error: null,
      next_retry_at: null,
      provider_job_id: null,
    });
  }

  /**
   * 手动重打/补打（owner / manager）
   */
  async reprintOrder(orderId: number): Promise<{ enqueued: number }> {
    const order = await this.readOrder(orderId);
    if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', msg: '订单不存在' });
    const printers = (await this.repo.listPrinters()).filter((p) => p.enabled);
    let count = 0;
    for (const p of printers) {
      try {
        await this.enqueueJobForPrinter(p, order, 'REPRINT');
        count += 1;
      } catch (err) {
        this.logger.warn(`[print] reprint enqueue failed for printer ${p.id}: ${(err as Error).message}`);
      }
    }
    return { enqueued: count };
  }

  /**
   * 重试 tick：每 30 秒由 scheduler 调用
   *
   * - 离线打印机不下发（Property 21.a）
   * - 在线打印机：FIFO 取最多 50 条 PENDING（Property 21.b）
   * - 失败按重试调度更新 next_retry_at；3 次失败标记 FAILED 并发 mop:printer-error
   */
  async runRetryTick(): Promise<{ sent: number; failed: number }> {
    const now = this.clock();
    let sent = 0;
    let failed = 0;
    try {
      const due = await this.repo.listDuePending(now, RETRY_TICK_BATCH_PER_PRINTER);
      if (due.length === 0) return { sent, failed };
      // 按 printer_id 分组（保持每组按 created_at 升序，源 SQL 已 asc）
      const byPrinter = new Map<number, PrintJobRow[]>();
      for (const job of due) {
        const arr = byPrinter.get(job.printer_id) ?? [];
        if (arr.length < RETRY_TICK_BATCH_PER_PRINTER) {
          arr.push(job);
          byPrinter.set(job.printer_id, arr);
        }
      }
      for (const [printerId, jobs] of byPrinter) {
        const printer = await this.repo.findPrinterByIdWithKey(printerId, (enc) => this.aes.decrypt(enc));
        if (!printer || !printer.enabled) continue;
        const driver = this.drivers.get(printer.provider);
        if (!driver) continue;
        // 检测在线状态；离线则跳过整组（Property 21.a）
        let online = true;
        try {
          const r = await driver.queryOnline(printer);
          online = r.online;
          if (online) {
            await this.repo.updatePrinter(printerId, { last_online_at: now });
          }
        } catch {
          online = false;
        }
        if (!online) continue;

        for (const job of jobs) {
          const result = await this.dispatchJob(driver, printer, job);
          if (result === 'success') sent += 1;
          else failed += result === 'failed-final' ? 1 : 0;
        }
      }
    } catch (err) {
      this.logger.error(`[print] runRetryTick error: ${(err as Error).message}`);
    }
    return { sent, failed };
  }

  /**
   * 派发单条 job。返回 'success' | 'retry-scheduled' | 'failed-final'
   */
  private async dispatchJob(driver: PrinterDriverPort, printer: PrinterRow, job: PrintJobRow): Promise<'success' | 'retry-scheduled' | 'failed-final'> {
    const now = this.clock();
    let resp: DriverResponse;
    try {
      resp = await driver.send(printer, job.payload_json, SEND_TIMEOUT_MS);
    } catch (err) {
      resp = { accepted: false, errorCode: (err as Error).message?.includes('timeout') ? 'UPSTREAM_TIMEOUT' : 'PRINT_FAILED', errorMessage: (err as Error).message };
    }
    if (resp.accepted) {
      await this.repo.updateJob(job.id, {
        status: 'SUCCESS',
        attempt: job.attempt + 1,
        provider_job_id: resp.providerJobId ?? null,
        completed_at: now,
        last_error: null,
      });
      return 'success';
    }
    // 失败：判定是否还能重试
    const nextAttempt = job.attempt + 1;
    if (nextAttempt < RETRY_DELAYS_MS.length + 1 && nextAttempt <= 3) {
      const nextAt = PrintCore.computeNextRetryAt(now, nextAttempt as 1 | 2 | 3);
      await this.repo.updateJob(job.id, {
        status: 'PENDING',
        attempt: nextAttempt,
        next_retry_at: nextAt,
        last_error: (resp.errorMessage || resp.errorCode || '未知错误').slice(0, 500),
      });
      return 'retry-scheduled';
    }
    // 终态失败
    await this.repo.updateJob(job.id, {
      status: 'FAILED',
      attempt: nextAttempt,
      last_error: (resp.errorMessage || resp.errorCode || '未知错误').slice(0, 500),
      completed_at: now,
    });
    try {
      this.emitter.emit('mop:printer-error', {
        printerId: printer.id,
        printerName: printer.name,
        jobId: job.id,
        orderId: job.order_id,
        errorCode: resp.errorCode ?? 'PRINT_FAILED',
        errorMessage: resp.errorMessage ?? null,
      });
    } catch (err) {
      this.logger.warn(`[print] emit mop:printer-error failed: ${(err as Error).message}`);
    }
    return 'failed-final';
  }

  async listJobsByPrinter(printerId: number, limit = 100): Promise<PrintJobRow[]> {
    const cur = await this.repo.findPrinterById(printerId);
    if (!cur) throw new NotFoundException({ code: 'PRINTER_NOT_FOUND', msg: '打印机不存在' });
    return await this.repo.listJobsByPrinter(printerId, limit);
  }

  async listJobsByOrder(orderId: number): Promise<PrintJobRow[]> {
    return await this.repo.listJobsByOrder(orderId);
  }

  /** 7 天清理（cron） */
  async cleanupOldJobs(now: Date = this.clock(), retentionDays = 7, batchSize = 1000, maxRounds = 100): Promise<{ removed: number }> {
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
    let total = 0;
    for (let i = 0; i < maxRounds; i++) {
      const n = await this.repo.deleteOldJobs(cutoff, batchSize);
      total += n;
      if (n < batchSize) break;
    }
    return { removed: total };
  }

  // ============================================================
  // 工具
  // ============================================================
  private fmtDateTime(d: Date): string {
    if (!(d instanceof Date) || isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
