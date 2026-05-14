import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { CreateDishDto, UpdateDishDto, CreateDishSpecDto, CreateCategoryDto } from './dto/dish.dto';

@Injectable()
export class DishesService {
  private client = getSupabaseClient();

  // 获取所有菜品分类
  async getCategories() {
    const { data, error } = await this.client
      .from('dish_categories')
      .select('*')
      .order('sort_order', { ascending: true });

    if (error) throw new BadRequestException(`获取分类失败: ${error.message}`);
    return data;
  }

  // 创建菜品分类
  async createCategory(dto: CreateCategoryDto) {
    const { data, error } = await this.client
      .from('dish_categories')
      .insert(dto)
      .select()
      .single();

    if (error) throw new BadRequestException(`创建分类失败: ${error.message}`);
    return data;
  }

  // 获取所有菜品（含规格）
  async getDishes(categoryId?: number) {
    let query = this.client
      .from('dishes')
      .select(`
        *,
        dish_categories(name),
        dish_specs(*)
      `)
      .order('sort_order', { ascending: true });

    if (categoryId) {
      query = query.eq('category_id', categoryId);
    }

    const { data, error } = await query;

    if (error) throw new BadRequestException(`获取菜品失败: ${error.message}`);
    return data;
  }

  // 获取单个菜品详情
  async getDishById(id: number) {
    const { data, error } = await this.client
      .from('dishes')
      .select(`
        *,
        dish_categories(name),
        dish_specs(*)
      `)
      .eq('id', id)
      .maybeSingle();

    if (error) throw new BadRequestException(`获取菜品失败: ${error.message}`);
    if (!data) throw new NotFoundException('菜品不存在');

    return data;
  }

  // 创建菜品
  async createDish(dto: CreateDishDto) {
    const { data, error } = await this.client
      .from('dishes')
      .insert({
        ...dto,
        status: 'available',
      })
      .select()
      .single();

    if (error) throw new BadRequestException(`创建菜品失败: ${error.message}`);
    return data;
  }

  // 更新菜品
  async updateDish(id: number, dto: UpdateDishDto) {
    const { data, error } = await this.client
      .from('dishes')
      .update({
        ...dto,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) throw new BadRequestException(`更新菜品失败: ${error.message}`);
    if (!data) throw new NotFoundException('菜品不存在');

    return data;
  }

  // 菜品上架/下架
  async toggleDishStatus(id: number) {
    const dish = await this.getDishById(id);
    const newStatus = dish.status === 'available' ? 'unavailable' : 'available';

    const { data, error } = await this.client
      .from('dishes')
      .update({
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new BadRequestException(`操作失败: ${error.message}`);
    return data;
  }

  // 删除菜品
  async deleteDish(id: number) {
    const { error } = await this.client
      .from('dishes')
      .delete()
      .eq('id', id);

    if (error) throw new BadRequestException(`删除菜品失败: ${error.message}`);
    return { message: '删除成功' };
  }

  // 添加菜品规格
  async addDishSpec(dto: CreateDishSpecDto) {
    const { data, error } = await this.client
      .from('dish_specs')
      .insert(dto)
      .select()
      .single();

    if (error) throw new BadRequestException(`添加规格失败: ${error.message}`);
    return data;
  }

  // 删除菜品规格
  async deleteDishSpec(id: number) {
    const { error } = await this.client
      .from('dish_specs')
      .delete()
      .eq('id', id);

    if (error) throw new BadRequestException(`删除规格失败: ${error.message}`);
    return { message: '删除成功' };
  }
}
