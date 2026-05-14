import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { CreateTableDto, UpdateTableDto } from './dto/table.dto';

@Injectable()
export class TablesService {
  private client = getSupabaseClient();

  // 获取所有桌台
  async getTables() {
    const { data, error } = await this.client
      .from('tables')
      .select('*')
      .order('table_number', { ascending: true });

    if (error) throw new BadRequestException(`获取桌台失败: ${error.message}`);
    return data;
  }

  // 获取单个桌台详情
  async getTableById(id: number) {
    const { data, error } = await this.client
      .from('tables')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw new BadRequestException(`获取桌台失败: ${error.message}`);
    if (!data) throw new NotFoundException('桌台不存在');

    return data;
  }

  // 根据桌台编号获取桌台
  async getTableByNumber(tableNumber: string) {
    const { data, error } = await this.client
      .from('tables')
      .select('*')
      .eq('table_number', tableNumber)
      .maybeSingle();

    if (error) throw new BadRequestException(`获取桌台失败: ${error.message}`);
    if (!data) throw new NotFoundException('桌台不存在');

    return data;
  }

  // 创建桌台
  async createTable(dto: CreateTableDto) {
    // 生成二维码URL（简化版，实际应该生成真实二维码）
    const qrCodeUrl = `https://example.com/qr/${dto.table_number}`;

    const { data, error } = await this.client
      .from('tables')
      .insert({
        ...dto,
        qr_code_url: qrCodeUrl,
        status: 'idle',
      })
      .select()
      .single();

    if (error) throw new BadRequestException(`创建桌台失败: ${error.message}`);
    return data;
  }

  // 更新桌台
  async updateTable(id: number, dto: UpdateTableDto) {
    const { data, error } = await this.client
      .from('tables')
      .update({
        ...dto,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) throw new BadRequestException(`更新桌台失败: ${error.message}`);
    if (!data) throw new NotFoundException('桌台不存在');

    return data;
  }

  // 更新桌台状态
  async updateTableStatus(id: number, status: 'idle' | 'occupied' | 'settled') {
    const { data, error } = await this.client
      .from('tables')
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) throw new BadRequestException(`更新状态失败: ${error.message}`);
    if (!data) throw new NotFoundException('桌台不存在');

    return data;
  }

  // 删除桌台
  async deleteTable(id: number) {
    const { error } = await this.client
      .from('tables')
      .delete()
      .eq('id', id);

    if (error) throw new BadRequestException(`删除桌台失败: ${error.message}`);
    return { message: '删除成功' };
  }

  // 生成桌台二维码
  async generateQrCode(id: number) {
    const table = await this.getTableById(id);

    // TODO: 实际应该调用二维码生成服务
    // 这里简化返回一个模拟的二维码URL
    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=https://your-domain.com/order?table=${table.table_number}`;

    // 更新数据库中的二维码URL
    const { data, error } = await this.client
      .from('tables')
      .update({
        qr_code_url: qrCodeUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new BadRequestException(`生成二维码失败: ${error.message}`);
    return data;
  }
}
