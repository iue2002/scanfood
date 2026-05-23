/**
 * Export Artifact Adapter：ExcelJS + PDFKit 实现
 *
 * 仅 IO，不含业务规则；可被替换成内存版（PBT 测试时）。
 */
import { Injectable, Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import PDFDocument = require('pdfkit');
import type { ExportArtifactPort } from './export.core';
import type { ReportAggregate } from './export.types';

const TMP_BASE = path.join(os.tmpdir(), 'scanfood-exports');

@Injectable()
export class ExcelPdfArtifactAdapter implements ExportArtifactPort {
  private readonly logger = new Logger(ExcelPdfArtifactAdapter.name);

  private async ensureTmpDir(): Promise<void> {
    try {
      await fs.mkdir(TMP_BASE, { recursive: true });
    } catch { /* exists */ }
  }

  async buildOrdersXlsxBuffer(
    headers: string[],
    rows: any[][],
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Scanfood';
    wb.created = new Date();
    const ws = wb.addWorksheet('订单');
    ws.columns = headers.map((h) => ({ header: h, key: h, width: Math.max(12, h.length * 2) }));
    // 表头加粗
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
    for (const r of rows) ws.addRow(r);

    // 金额列两位小数（列 7 / 8 = 金额 / 退款）
    [7, 8].forEach((idx) => {
      ws.getColumn(idx).numFmt = '0.00';
    });

    const ab = await wb.xlsx.writeBuffer();
    const buffer = Buffer.from(ab as ArrayBuffer);
    const fileName = `orders-${this.fileSafeStamp()}.xlsx`;
    return { buffer, fileName };
  }

  async buildOrdersXlsx(
    jobId: string,
    headers: string[],
    runStream: (push: (row: any[]) => Promise<void>) => Promise<void>,
  ): Promise<{ filePath: string; fileSize: number; fileName: string }> {
    await this.ensureTmpDir();
    const fileName = `orders-${jobId}.xlsx`;
    const filePath = path.join(TMP_BASE, fileName);

    const wb = new ExcelJS.stream.xlsx.WorkbookWriter({
      filename: filePath,
      useStyles: true,
      useSharedStrings: false,
    });
    wb.creator = 'Scanfood';
    wb.created = new Date();
    const ws = wb.addWorksheet('订单');
    ws.columns = headers.map((h) => ({ header: h, key: h, width: Math.max(12, h.length * 2) }));
    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
    headerRow.commit();
    [7, 8].forEach((idx) => {
      ws.getColumn(idx).numFmt = '0.00';
    });

    await runStream(async (row) => {
      ws.addRow(row).commit();
    });
    ws.commit();
    await wb.commit();

    const stat = await fs.stat(filePath);
    return { filePath, fileSize: stat.size, fileName };
  }

  async buildReportPdf(agg: ReportAggregate): Promise<{ buffer: Buffer; fileName: string }> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 36 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const fileName = `report-${agg.type.toLowerCase()}-${agg.date}.pdf`;
        resolve({ buffer, fileName });
      });
      doc.on('error', (err) => reject(err));

      try {
        // 页眉：店名 + 类型 + 时间 + 生成人
        doc.fontSize(18).text(`${agg.storeName} · ${agg.type === 'DAILY' ? '日报' : '月报'} (${agg.date})`, { align: 'left' });
        doc.moveDown(0.3);
        doc.fontSize(10).fillColor('#64748B').text(
          `生成时间：${this.fmt(agg.generatedAt)}    生成人：${agg.generatedBy}`,
          { align: 'left' },
        );
        doc.moveDown(0.6);
        doc.strokeColor('#E2E8F0').lineWidth(0.5).moveTo(36, doc.y).lineTo(559, doc.y).stroke();
        doc.moveDown(0.6);

        // 关键指标
        doc.fillColor('#0F172A').fontSize(12).text('关键指标', { underline: false });
        doc.moveDown(0.3);
        const cells = [
          ['订单数', String(agg.orderCount)],
          ['营业额', `¥${agg.revenue.toFixed(2)}`],
          ['退款额', `¥${agg.refundAmount.toFixed(2)}`],
          ['桌均', `¥${agg.perTableAverage.toFixed(2)}`],
        ];
        const startY = doc.y;
        let x = 36;
        for (const [k, v] of cells) {
          doc.rect(x, startY, 125, 50).fillAndStroke('#F8FAFC', '#E2E8F0');
          doc.fillColor('#64748B').fontSize(10).text(k, x + 8, startY + 8, { width: 110 });
          doc.fillColor('#0F172A').fontSize(16).text(v, x + 8, startY + 24, { width: 110 });
          x += 130;
        }
        doc.y = startY + 65;

        // 品类销量
        doc.moveDown(0.5);
        doc.fillColor('#0F172A').fontSize(12).text('品类销量', { underline: false });
        doc.moveDown(0.2);
        if (agg.categorySales.length === 0) {
          doc.fontSize(10).fillColor('#94A3B8').text('（暂无数据）');
        } else {
          this.renderTable(doc, ['品类', '数量', '金额'], agg.categorySales.map((c) => [
            c.category, String(c.quantity), `¥${c.amount.toFixed(2)}`,
          ]));
        }

        // Top 菜品
        doc.moveDown(0.5);
        doc.fillColor('#0F172A').fontSize(12).text('Top10 菜品', { underline: false });
        doc.moveDown(0.2);
        if (agg.topDishes.length === 0) {
          doc.fontSize(10).fillColor('#94A3B8').text('（暂无数据）');
        } else {
          this.renderTable(doc, ['菜品', '销量', '销售额'], agg.topDishes.map((d) => [
            d.name, String(d.quantity), `¥${d.amount.toFixed(2)}`,
          ]));
        }

        // 月报趋势
        if (agg.dailyTrend && agg.dailyTrend.length > 0) {
          doc.moveDown(0.5);
          doc.fillColor('#0F172A').fontSize(12).text('每日趋势', { underline: false });
          doc.moveDown(0.2);
          this.renderTable(doc, ['日期', '订单数', '营业额'], agg.dailyTrend.map((t) => [
            t.date, String(t.orderCount), `¥${t.revenue.toFixed(2)}`,
          ]));
        }

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  async removeFile(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch (err: any) {
      if (err?.code === 'ENOENT') return;
      throw err;
    }
  }

  // ============================================================
  // 工具
  // ============================================================
  private renderTable(doc: any, headers: string[], rows: string[][]): void {
    const tableLeft = 36;
    const tableRight = 559;
    const colWidth = (tableRight - tableLeft) / headers.length;
    const lineH = 18;
    const drawRow = (cells: string[], opts?: { bold?: boolean; bg?: string }) => {
      const y = doc.y;
      if (opts?.bg) {
        doc.rect(tableLeft, y, tableRight - tableLeft, lineH).fillAndStroke(opts.bg, '#E2E8F0');
      } else {
        doc.rect(tableLeft, y, tableRight - tableLeft, lineH).strokeColor('#E2E8F0').stroke();
      }
      cells.forEach((c, i) => {
        doc.fillColor('#0F172A').fontSize(10).text(c, tableLeft + 6 + i * colWidth, y + 4, {
          width: colWidth - 12,
          height: lineH - 4,
          ellipsis: true,
        });
      });
      doc.y = y + lineH;
    };

    drawRow(headers, { bold: true, bg: '#F8FAFC' });
    for (const row of rows) {
      // 分页
      if (doc.y + lineH > 800) {
        doc.addPage();
      }
      drawRow(row);
    }
  }

  private fmt(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  private fileSafeStamp(): string {
    return new Date().toISOString().replace(/[:.]/g, '-');
  }
}
