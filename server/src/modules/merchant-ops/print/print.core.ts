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
  TAKEAWAY_TABLE_SENTINEL,
  TEST_PRINT_TIMEOUT_MS,
} from './print.types';
import type { Aes256Encryptor } from './aes-encryptor';

/** 渲染桌号字段时的友好显示 */
function formatTableLabel(payload: PrintPayload): { label: string; value: string } {
  const isTakeaway = payload.order_type === 'takeaway' || payload.table_number === TAKEAWAY_TABLE_SENTINEL;
  if (isTakeaway) {
    // 外带订单：不显示桌号字段名，只标"外带"
    return { label: '类型', value: '🛍️ 外带' };
  }
  return { label: '桌号', value: payload.table_number ?? '-' };
}

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

/**
 * 预览样本数据提供者：从真实店铺/菜品里取 1-3 项，没数据时返回 null
 * （由 module factory 注入，从 store_settings + dishes 表读）
 */
export interface PreviewSampleProvider {
  getStoreName(): Promise<string | null>;
  getSampleItems(): Promise<Array<{ name: string; spec: string | null; quantity: number; subtotal: number }>>;
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
    /** 预览样本数据源；不注入时使用通用 placeholder */
    private readonly sampleProvider?: PreviewSampleProvider,
    /** 打印方案 core；不注入时退化为旧行为（每台 enabled 打印机各打整单一份） */
    private readonly planCore?: import('./plan.core').PrintPlanCore,
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
        case 'TABLE_NUMBER': {
          const t = formatTableLabel(payload);
          lines.push(`${t.label}：${t.value}`);
          break;
        }
        case 'ORDER_NO':
          lines.push(`订单号：${payload.order_no ?? '-'}`);
          break;
        case 'TIME':
          lines.push(`时间：${payload.order_time ?? '-'}`);
          break;
        case 'OPERATOR':
          // 仅在 payload 真有 operator 时打印；没有时整行省略，避免出现 "操作员：-"
          if (payload.operator && payload.operator.trim().length > 0) {
            lines.push(`操作员：${payload.operator}`);
          }
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
        case 'TABLE_NUMBER': {
          const t = formatTableLabel(payload);
          blocks.push(`<div class="row"><span>${escapeHtml(t.label)}</span><b>${escapeHtml(t.value)}</b></div>`);
          break;
        }
        case 'ORDER_NO':
          blocks.push(`<div class="row"><span>订单号</span><b>${escapeHtml(payload.order_no ?? '-')}</b></div>`);
          break;
        case 'TIME':
          blocks.push(`<div class="row"><span>时间</span><b>${escapeHtml(payload.order_time ?? '-')}</b></div>`);
          break;
        case 'OPERATOR':
          // 仅当 payload 真有 operator 时显示；空则整行省略
          if (payload.operator && payload.operator.trim().length > 0) {
            blocks.push(`<div class="row"><span>操作员</span><b>${escapeHtml(payload.operator)}</b></div>`);
          }
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
  async previewTemplate(id: number, sample?: PrintPayload, isTakeaway = false): Promise<{ escpos: string; html: string }> {
    const tpl = await this.getTemplate(id);
    const payload: PrintPayload = sample ?? await this.buildPreviewPayload(tpl, isTakeaway);
    return {
      escpos: PrintCore.renderEscPos(tpl, { ...payload, fields: tpl.fields_json, width: tpl.width }),
      html: PrintCore.renderHtml(tpl, payload),
    };
  }

  /**
   * 优先用真实 store + 真实菜品做样本；任何步骤失败则退回通用占位
   * （这样预览反映真实业务，不会出现"宫保鸡丁"这种与业务无关的硬编码）
   */
  private async buildPreviewPayload(tpl: TemplateRow, isTakeaway = false): Promise<PrintPayload> {
    let storeName: string | null = null;
    let items: Array<{ name: string; spec: string | null; quantity: number; subtotal: number }> = [];
    if (this.sampleProvider) {
      try { storeName = await this.sampleProvider.getStoreName(); } catch { /* fall through */ }
      try { items = await this.sampleProvider.getSampleItems(); } catch { /* fall through */ }
    }
    if (items.length === 0) {
      items = [
        { name: '示例商品 A', spec: null, quantity: 1, subtotal: 0 },
        { name: '示例商品 B', spec: null, quantity: 1, subtotal: 0 },
      ];
    }
    const total = items.reduce((sum, it) => sum + (it.subtotal || 0), 0);
    return {
      width: tpl.width,
      fields: tpl.fields_json,
      store_name: storeName ?? '示例店铺',
      table_number: isTakeaway ? TAKEAWAY_TABLE_SENTINEL : '8',
      order_type: isTakeaway ? 'takeaway' : 'dine_in',
      order_no: 'OD-PREVIEW-001',
      order_time: this.fmtDateTime(this.clock()),
      items,
      total,
      remark: '（这是模板预览，实际打印按订单数据渲染）',
      operator: null,  // 预览也不假装有操作员，与真实打印一致
    };
  }

  /**
   * 试打印的样本：与预览共享同一构造器
   */
  private async buildSamplePayloadForTest(tpl: TemplateRow): Promise<PrintPayload> {
    return await this.buildPreviewPayload(tpl);
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
    const payload: PrintPayload = await this.buildSamplePayloadForTest(tpl);

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
   *
   * 走 plan 模型：
   *   1. 解析 order_type 对应的默认 plan（无则系统默认）
   *   2. **加餐时只取本轮新增的 items**（diff = 未在历史 jobs 的 selected_item_ids 中出现的 add_more items）
   *   3. plan.splitOrderByPlan(items) 拆成多张票
   *   4. 每张票按"打印机的 auto_print/auto_print_add_more 标记"过滤后入队
   */
  async onOrderEvent(orderId: number, trigger: 'NEW_ORDER' | 'ADD_MORE'): Promise<void> {
    try {
      const order = await this.readOrder(orderId);
      if (!order) {
        this.logger.warn(`[print] order ${orderId} not found, skip auto print`);
        return;
      }

      // 1) 拿到 auto_print 打印机集合（按 trigger 过滤）
      const autoPrinters = await this.repo.listAutoPrinters(trigger);
      if (autoPrinters.length === 0) return;
      const autoPrinterIds = new Set(autoPrinters.map((p) => p.id));

      // 1.5) 加餐路径：只取"未被任何历史 job 打印过"的 add_more 菜品
      //      普通 orderUpdated（改数量/上菜状态/删菜）会被去重为 0，自然跳过
      let itemsToPrint = order.items;
      let addMoreRound = 0;
      let printLabel: string | null = null;
      if (trigger === 'ADD_MORE') {
        const diff = await this.computeAddMoreDiff(order);
        if (diff.items.length === 0) {
          // 没有新加餐项目（可能是上菜/删菜/改数量等普通更新），不打印
          this.logger.debug(`[print] order ${orderId} ADD_MORE: 无新加餐项目，跳过`);
          return;
        }
        itemsToPrint = diff.items;
        addMoreRound = diff.maxRound;
        printLabel = `加餐 #${addMoreRound}`;
        this.logger.log(`[print] order ${orderId} ADD_MORE: 打印 ${diff.items.length} 道新菜（轮次 ${addMoreRound}）`);
      }

      // 2) 走 plan（如果可用）
      if (this.planCore) {
        try {
          const orderType = (order.order_type === 'takeaway' ? 'takeaway' : 'dine_in') as 'takeaway' | 'dine_in';
          const plan = await this.planCore.resolvePlanForOrder(orderType);
          const { PrintPlanCore } = await import('./plan.core');
          const split = PrintPlanCore.splitOrderByPlan(plan, itemsToPrint.map((it) => ({
            order_item_id: it.order_item_id,
            category_id: it.category_id,
            name: it.name,
            spec: it.spec,
            quantity: it.quantity,
            subtotal: it.subtotal,
          })));

          // 系统默认 plan 是空 slices（迁移时只插了 plan 行没插 slices）→ 退化路径
          if (plan.slices.length === 0) {
            const onlyIds = trigger === 'ADD_MORE' ? itemsToPrint.map((it) => it.order_item_id) : undefined;
            for (const p of autoPrinters) {
              await this.enqueueJobForPrinter(p, order, trigger, onlyIds, printLabel).catch((err) => {
                this.logger.error(`[print] enqueue failed for printer ${p.id}: ${(err as Error).message}`);
              });
            }
          } else {
            // 按 plan 切片入队（过滤掉非 auto_print 的打印机）
            for (const dispatch of split.dispatches) {
              if (!autoPrinterIds.has(dispatch.printer_id)) continue;
              const printer = autoPrinters.find((p) => p.id === dispatch.printer_id);
              if (!printer) continue;
              // 把"加餐 #N"叠加到切片标签上（如果切片本身有 label，则连接）
              const dispatchWithLabel = printLabel
                ? { ...dispatch, label: dispatch.label ? `${printLabel} · ${dispatch.label}` : printLabel }
                : dispatch;
              await this.enqueueDispatch(printer, order, dispatchWithLabel, plan.id, trigger).catch((err) => {
                this.logger.error(`[print] enqueue dispatch failed for printer ${dispatch.printer_id}: ${(err as Error).message}`);
              });
            }
            // uncovered：发警告，但仍按"系统默认"兜底打印
            if (split.uncovered.length > 0) {
              try {
                this.emitter.emit('mop:print-uncovered', {
                  orderId: order.order_id,
                  orderNo: order.order_no,
                  planId: plan.id,
                  planName: plan.name,
                  uncoveredItems: split.uncovered.map((u) => ({ name: u.name, category_id: u.category_id })),
                });
              } catch { /* ignore */ }
              this.logger.warn(`[print] order ${orderId} 有 ${split.uncovered.length} 个 items 未被 plan ${plan.id} 切片覆盖，发警告事件`);
              // 兜底：未覆盖的 items 仍发到所有 auto_print 打印机
              for (const p of autoPrinters) {
                await this.enqueueJobForPrinter(p, order, trigger, split.uncovered.map((u) => u.order_item_id), printLabel).catch((err) => {
                  this.logger.warn(`[print] uncovered fallback enqueue failed: ${(err as Error).message}`);
                });
              }
            }
          }
          return;
        } catch (err) {
          // 走 plan 失败：退化到旧行为（每台 enabled+auto_print 打印机各打一份）
          this.logger.warn(`[print] plan dispatch failed, fallback to per-printer: ${(err as Error).message}`);
        }
      }

      // 3) 退化路径：planCore 不可用 → 每台 auto_print 打印机各打整单（或加餐 diff）一份
      const onlyIdsFallback = trigger === 'ADD_MORE' ? itemsToPrint.map((it) => it.order_item_id) : undefined;
      for (const p of autoPrinters) {
        await this.enqueueJobForPrinter(p, order, trigger, onlyIdsFallback, printLabel).catch((err) => {
          this.logger.error(`[print] enqueue failed for printer ${p.id}: ${(err as Error).message}`);
        });
      }
    } catch (err) {
      // R19.5 / Property 19：core 边界吞错误
      this.logger.error(`[print] onOrderEvent error: ${(err as Error).message}`);
    }
  }

  /**
   * 计算"加餐 diff"：返回未在历史 print_jobs 的 selected_item_ids 中出现的 add_more items
   *
   * 历史覆盖的判定（保守、不重打）：
   *   - 任何 status ∈ {PENDING, SENT, SUCCESS} 的 job
   *     - selected_item_ids 非空：覆盖这些具体 item id
   *     - selected_item_ids 为空（NULL）：trigger=NEW_ORDER 视为覆盖全部 phase='order' 项；
   *                                       trigger=ADD_MORE 视为已经打过当时所有 add_more 项；
   *                                       trigger=REPRINT/SELECTIVE 不参与（会写 selected_item_ids）
   *
   * 失败的 job (status=FAILED) 不算覆盖（让加餐 diff 仍包含它们 → 商家可手动补打）
   */
  private async computeAddMoreDiff(order: OrderProjection): Promise<{ items: OrderProjection['items']; maxRound: number }> {
    let printedIds = new Set<number>();
    let coversAllPhaseOrder = false;
    let coversAllAddMoreSnapshot: Date | null = null;
    let allOrderItemsSnapshot = new Set<number>(); // 在历史 NEW_ORDER 时已存在的 phase='order' items
    try {
      const pastJobs = await this.repo.listJobsByOrder(order.order_id);
      for (const job of pastJobs) {
        if (job.status === 'FAILED') continue;
        if (job.selected_item_ids && job.selected_item_ids.length > 0) {
          for (const id of job.selected_item_ids) printedIds.add(id);
        } else {
          // 整单 job（selected_item_ids 为 null/空）
          if (job.trigger === 'NEW_ORDER') {
            coversAllPhaseOrder = true;
          } else if (job.trigger === 'ADD_MORE') {
            // 旧版本（升级前）的 ADD_MORE 整单 job：保守视为覆盖到 job.created_at 之前的所有 add_more 项
            if (!coversAllAddMoreSnapshot || job.created_at > coversAllAddMoreSnapshot) {
              coversAllAddMoreSnapshot = job.created_at as Date;
            }
          }
        }
      }
      if (coversAllPhaseOrder) {
        for (const it of order.items) {
          if (it.phase === 'order') allOrderItemsSnapshot.add(it.order_item_id);
        }
      }
    } catch (err) {
      this.logger.warn(`[print] computeAddMoreDiff: listJobsByOrder failed (${(err as Error).message})，保守按全部 add_more 处理`);
    }

    const diff = order.items.filter((it) => {
      if (it.phase !== 'add_more') return false;
      if (printedIds.has(it.order_item_id)) return false;
      if (allOrderItemsSnapshot.has(it.order_item_id)) return false;
      // 旧版本兼容：如果存在 ADD_MORE 整单 job，且 item 是它打印之前就有的，视为已打过
      // 这里没有 item 创建时间，但 add_more_round 可作为代理：旧 round 的视为已打
      // 保守起见，若有 coversAllAddMoreSnapshot 但当前 round 是已知最大轮 + 0/-，视为可能已打 → 仅当 round 为最大时才认为新增
      return true;
    });

    let maxRound = 0;
    for (const it of diff) {
      if (it.add_more_round > maxRound) maxRound = it.add_more_round;
    }

    // 旧整单 ADD_MORE 兼容：如果有快照覆盖时间，且 diff 中存在 add_more_round 比"快照之前最大轮"还小的 item，过滤掉
    // 实际上 round 会单调递增，所以最简单的策略：找出"快照覆盖前的最大 round"
    if (coversAllAddMoreSnapshot && diff.length > 0) {
      // 因为没有 item 的 created_at，我们只能保守：跳过 round 严格小于 maxRound 的项（仅打最新一轮）
      // 这避免了重复打印过去几轮的问题（升级前的状态）
      const latestRoundOnly = diff.filter((it) => it.add_more_round === maxRound);
      if (latestRoundOnly.length > 0) {
        return { items: latestRoundOnly, maxRound };
      }
    }

    return { items: diff, maxRound };
  }

  /**
   * 把 plan 切片转成 print_job：仅打 dispatch.items 中的菜品
   */
  private async enqueueDispatch(
    printer: PrinterRow,
    order: OrderProjection,
    dispatch: import('./print.types').PlanDispatchResult,
    planId: number,
    trigger: PrintJobTrigger,
  ): Promise<PrintJobRow> {
    const templateId = dispatch.template_id ?? printer.template_id ?? (printer.role === 'KITCHEN' ? 2 : 1);
    const tpl = await this.repo.findTemplateById(templateId) ?? await this.repo.findTemplateById(1);
    if (!tpl) throw new Error('no template available');

    // 构造 payload：item 列表来自 dispatch（按 plan 切片过滤后的）
    // 角色字段过滤：用 splitJobsByRole 的逻辑
    const plans = PrintCore.splitJobsByRole([printer], tpl);
    const fields = plans[0] ? plans[0].fields : tpl.fields_json;

    const payload: PrintPayload = {
      width: tpl.width,
      fields,
      store_name: order.store_name,
      table_number: order.table_number,
      order_type: order.order_type,
      order_no: dispatch.label
        ? `${order.order_no} · ${dispatch.label}`
        : order.order_no,
      order_time: this.fmtDateTime(order.created_at),
      items: dispatch.items.map((it) => ({ name: it.name, quantity: it.quantity, spec: it.spec, subtotal: it.subtotal })),
      total: dispatch.items.reduce((sum, it) => sum + it.subtotal, 0),
      remark: order.remark,
      operator: order.operator,
    };
    return await this.repo.insertJob({
      printer_id: printer.id,
      template_id: tpl.id,
      plan_id: planId,
      order_id: order.order_id,
      trigger,
      payload_json: payload,
      selected_item_ids: dispatch.items.map((it) => it.order_item_id),
      status: 'PENDING',
      attempt: 0,
      last_error: null,
      next_retry_at: null,
      provider_job_id: null,
    });
  }

  private async enqueueJobForPrinter(
    printer: PrinterRow,
    order: OrderProjection,
    trigger: PrintJobTrigger,
    onlyItemIds?: number[],
    printLabel?: string | null,
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

    // 过滤 items（选购打印用）
    const itemSet = onlyItemIds && onlyItemIds.length > 0 ? new Set(onlyItemIds) : null;
    const usedItems = itemSet
      ? order.items.filter((it) => itemSet.has(it.order_item_id))
      : order.items;
    const totalAmount = itemSet
      ? usedItems.reduce((sum, it) => sum + it.subtotal, 0)
      : order.total_amount;

    const payload: PrintPayload = {
      width: tpl.width,
      fields,
      store_name: order.store_name,
      table_number: order.table_number,
      order_type: order.order_type,
      order_no: printLabel ? `${order.order_no} · ${printLabel}` : order.order_no,
      order_time: this.fmtDateTime(order.created_at),
      items: usedItems.map((it) => ({ name: it.name, quantity: it.quantity, spec: it.spec, subtotal: it.subtotal })),
      total: totalAmount,
      remark: order.remark,
      operator: order.operator,
    };
    return await this.repo.insertJob({
      printer_id: printer.id,
      template_id: tpl.id,
      plan_id: null,
      order_id: order.order_id,
      trigger,
      payload_json: payload,
      selected_item_ids: itemSet ? Array.from(itemSet) : null,
      status: 'PENDING',
      attempt: 0,
      last_error: null,
      next_retry_at: null,
      provider_job_id: null,
    });
  }

  /**
   * 手动重打/补打（owner / manager）
   *
   * @param planId 可选；指定 plan 时按方案拆单；不传时用订单类型的默认方案
   *               传 'system_default' 强制走系统默认（每台 enabled 打印机各打整单一份）
   */
  async reprintOrder(orderId: number, planId?: number | null): Promise<{ enqueued: number }> {
    const order = await this.readOrder(orderId);
    if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', msg: '订单不存在' });

    if (this.planCore) {
      try {
        const orderType = (order.order_type === 'takeaway' ? 'takeaway' : 'dine_in') as 'takeaway' | 'dine_in';
        const plan = await this.planCore.resolvePlanForOrder(orderType, planId ?? null);
        if (plan.slices.length > 0) {
          const { PrintPlanCore } = await import('./plan.core');
          const split = PrintPlanCore.splitOrderByPlan(plan, order.items.map((it) => ({
            order_item_id: it.order_item_id,
            category_id: it.category_id,
            name: it.name,
            spec: it.spec,
            quantity: it.quantity,
            subtotal: it.subtotal,
          })));
          let count = 0;
          const allPrinters = (await this.repo.listPrinters()).filter((p) => p.enabled);
          const printerMap = new Map(allPrinters.map((p) => [p.id, p]));
          for (const dispatch of split.dispatches) {
            const printer = printerMap.get(dispatch.printer_id);
            if (!printer) continue;
            try {
              await this.enqueueDispatch(printer, order, dispatch, plan.id, 'REPRINT');
              count += 1;
            } catch (err) {
              this.logger.warn(`[print] reprint dispatch failed for printer ${dispatch.printer_id}: ${(err as Error).message}`);
            }
          }
          // uncovered：兜底全打印机
          if (split.uncovered.length > 0) {
            this.logger.warn(`[print] reprint order ${orderId} 有 ${split.uncovered.length} 个 items 未被 plan ${plan.id} 覆盖，兜底全打`);
            for (const p of allPrinters) {
              try {
                await this.enqueueJobForPrinter(p, order, 'REPRINT', split.uncovered.map((u) => u.order_item_id));
                count += 1;
              } catch { /* swallow */ }
            }
          }
          return { enqueued: count };
        }
        // plan.slices 为空（系统默认 plan）→ 走退化
      } catch (err) {
        this.logger.warn(`[print] reprint via plan failed, fallback: ${(err as Error).message}`);
      }
    }

    // 退化：每台 enabled 打印机各打整单一份
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
   * 选购打印：商家手动勾选 items + 选打印机，单台单张票
   * 不走 plan，直接按 selected_item_ids 入队
   */
  async selectivePrint(req: import('./print.types').SelectivePrintRequest): Promise<{ jobId: number }> {
    if (!req.selected_item_ids || req.selected_item_ids.length === 0) {
      throw new BadRequestException({ code: 'SELECTIVE_EMPTY', msg: '至少选 1 道菜' });
    }
    const order = await this.readOrder(req.order_id);
    if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', msg: '订单不存在' });
    const printer = await this.repo.findPrinterById(req.printer_id);
    if (!printer || !printer.enabled) {
      throw new NotFoundException({ code: 'PRINTER_NOT_FOUND', msg: '打印机不存在或已禁用' });
    }
    // 校验 selected_item_ids 都属于该订单
    const orderItemIdSet = new Set(order.items.map((it) => it.order_item_id));
    for (const id of req.selected_item_ids) {
      if (!orderItemIdSet.has(id)) {
        throw new BadRequestException({ code: 'SELECTIVE_INVALID_ITEM', msg: `item ${id} 不属于订单 ${req.order_id}` });
      }
    }
    // 用指定模板覆盖（如果传了）
    const tplId = req.template_id ?? printer.template_id ?? (printer.role === 'KITCHEN' ? 2 : 1);
    const tpl = await this.repo.findTemplateById(tplId) ?? await this.repo.findTemplateById(1);
    if (!tpl) throw new Error('no template available');

    const itemSet = new Set(req.selected_item_ids);
    const usedItems = order.items.filter((it) => itemSet.has(it.order_item_id));
    const total = usedItems.reduce((sum, it) => sum + it.subtotal, 0);

    const plans = PrintCore.splitJobsByRole([printer], tpl);
    const fields = plans[0] ? plans[0].fields : tpl.fields_json;

    const payload: PrintPayload = {
      width: tpl.width,
      fields,
      store_name: order.store_name,
      table_number: order.table_number,
      order_type: order.order_type,
      order_no: req.label ? `${order.order_no} · ${req.label}` : `${order.order_no} · 选购`,
      order_time: this.fmtDateTime(order.created_at),
      items: usedItems.map((it) => ({ name: it.name, quantity: it.quantity, spec: it.spec, subtotal: it.subtotal })),
      total,
      remark: order.remark,
      operator: order.operator,
    };
    const job = await this.repo.insertJob({
      printer_id: printer.id,
      template_id: tpl.id,
      plan_id: null,
      order_id: order.order_id,
      trigger: 'SELECTIVE',
      payload_json: payload,
      selected_item_ids: Array.from(itemSet),
      status: 'PENDING',
      attempt: 0,
      last_error: null,
      next_retry_at: null,
      provider_job_id: null,
    });
    return { jobId: job.id };
  }

  /**
   * 打印日报/月报：把统计内容当作"items 行"入队到 1..N 台 CASHIER/BOTH 打印机
   *
   * 行为：
   *   - 不走 plan（报表不属于订单维度）
   *   - 选 enabled + auto_print + role IN (CASHIER, BOTH) 的所有打印机
   *   - 没匹配到时退化为：所有 enabled 打印机
   *   - 失败用 mop 现有的重试调度（30s / 2min / 10min）
   *
   * @param title 报表标题（如 "日报" / "月报"）
   * @param lines 报表行数组（如 ["营业额: ¥1234.56", "订单数: 42", "统计区间: 2026-05-01 至 2026-05-24"]）
   * @returns 入队的 job 数量
   */
  async printReport(title: string, lines: string[]): Promise<{ enqueued: number }> {
    if (!title || title.trim().length === 0) {
      throw new BadRequestException({ code: 'REPORT_TITLE_EMPTY', msg: '报表标题不能为空' });
    }
    if (!Array.isArray(lines) || lines.length === 0) {
      throw new BadRequestException({ code: 'REPORT_LINES_EMPTY', msg: '报表内容不能为空' });
    }
    // 选打印机：优先 CASHIER + BOTH 且 auto_print 启用
    const all = await this.repo.listPrinters();
    let targets = all.filter((p) => p.enabled && p.auto_print && (p.role === 'CASHIER' || p.role === 'BOTH'));
    if (targets.length === 0) {
      // 退化：所有 enabled 打印机各打一份
      targets = all.filter((p) => p.enabled);
    }
    if (targets.length === 0) {
      throw new BadRequestException({ code: 'NO_PRINTER_AVAILABLE', msg: '没有可用打印机' });
    }
    // 用系统默认前台模板 id=1
    const tpl = await this.repo.findTemplateById(1);
    if (!tpl) throw new Error('default template (id=1) missing');

    let enqueued = 0;
    for (const printer of targets) {
      try {
        // 字段：STORE_NAME + TIME + ITEMS（每行作为一个虚拟 item，quantity=1 / subtotal=0）
        const fields = (tpl.fields_json.includes('ITEMS') ? tpl.fields_json : ['STORE_NAME', 'TIME', 'ITEMS']) as TemplateField[];
        const payload: PrintPayload = {
          width: tpl.width,
          fields,
          store_name: title,
          order_no: title,
          order_time: this.fmtDateTime(this.clock()),
          items: lines.map((line) => ({ name: line, quantity: 1, spec: null, subtotal: 0 })),
          total: 0,
          remark: null,
          operator: null,
        };
        await this.repo.insertJob({
          printer_id: printer.id,
          template_id: tpl.id,
          plan_id: null,
          order_id: null,
          trigger: 'REPRINT', // 复用 REPRINT trigger（语义最接近：手动触发，非订单首发）
          payload_json: payload,
          selected_item_ids: null,
          status: 'PENDING',
          attempt: 0,
          last_error: null,
          next_retry_at: null,
          provider_job_id: null,
        });
        enqueued += 1;
      } catch (err) {
        this.logger.warn(`[print] printReport enqueue failed for printer ${printer.id}: ${(err as Error).message}`);
      }
    }
    return { enqueued };
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
