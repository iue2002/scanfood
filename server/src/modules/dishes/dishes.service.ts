import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { db } from '@/storage/database/mysql-client';
import { dishes, dish_categories, dish_specs } from '@/storage/database/shared/schema';
import { CreateDishDto, UpdateDishDto, CreateDishSpecDto, CreateCategoryDto } from './dto/dish.dto';
import { eq, asc, and } from 'drizzle-orm';

@Injectable()
export class DishesService {
  async getCategories() {
    return await db.select().from(dish_categories).orderBy(asc(dish_categories.sort_order));
  }

  async createCategory(dto: CreateCategoryDto) {
    const insertResult = await db.insert(dish_categories).values(dto);
    const newId = (insertResult as any)[0].insertId;
    const result = await db.select().from(dish_categories).where(eq(dish_categories.id, newId));
    return result[0];
  }

  async updateCategory(id: number, dto: CreateCategoryDto) {
    await db.update(dish_categories).set(dto).where(eq(dish_categories.id, id));
    const result = await db.select().from(dish_categories).where(eq(dish_categories.id, id));
    return result[0];
  }

  async deleteCategory(id: number) {
    await db.delete(dish_categories).where(eq(dish_categories.id, id));
    return { message: '删除成功' };
  }

  async getDishes(categoryId?: number, includeUnavailable?: boolean) {
    let dishList;
    if (categoryId) {
      if (includeUnavailable) {
        dishList = await db.select().from(dishes).where(eq(dishes.category_id, categoryId)).orderBy(asc(dishes.sort_order));
      } else {
        dishList = await db.select().from(dishes).where(and(eq(dishes.category_id, categoryId), eq(dishes.status, 'available'))).orderBy(asc(dishes.sort_order));
      }
    } else {
      if (includeUnavailable) {
        dishList = await db.select().from(dishes).orderBy(asc(dishes.sort_order));
      } else {
        dishList = await db.select().from(dishes).where(eq(dishes.status, 'available')).orderBy(asc(dishes.sort_order));
      }
    }

    const categoryList = await db.select().from(dish_categories);
    const specList = await db.select().from(dish_specs);

    return dishList.map(dish => ({
      ...dish,
      category: categoryList.find(c => c.id === dish.category_id)?.name || '',
      dish_specs: specList.filter(s => s.dish_id === dish.id),
    }));
  }

  async getDishById(id: number) {
    const result = await db.select().from(dishes).where(eq(dishes.id, id));
    const dish = result[0];
    if (!dish) throw new NotFoundException('菜品不存在');

    const categoryResult = await db.select().from(dish_categories).where(eq(dish_categories.id, dish.category_id));
    const specResult = await db.select().from(dish_specs).where(eq(dish_specs.dish_id, id));

    return {
      ...dish,
      category: categoryResult[0]?.name || '',
      dish_specs: specResult,
    };
  }

  async createDish(dto: CreateDishDto) {
    const insertResult = await db.insert(dishes).values({
      ...dto,
      price: dto.price.toFixed(2),
      status: 'available',
    });
    const newId = (insertResult as any)[0].insertId;
    return await this.getDishById(newId);
  }

  async updateDish(id: number, dto: UpdateDishDto) {
    const updateData: any = { ...dto };
    if (dto.price !== undefined) updateData.price = dto.price.toFixed(2);
    await db.update(dishes).set(updateData).where(eq(dishes.id, id));
    return await this.getDishById(id);
  }

  async toggleDishStatus(id: number) {
    const dish = await this.getDishById(id);
    const newStatus = dish.status === 'available' ? 'unavailable' : 'available';
    await db.update(dishes).set({ status: newStatus }).where(eq(dishes.id, id));
    return await this.getDishById(id);
  }

  async deleteDish(id: number) {
    await db.delete(dishes).where(eq(dishes.id, id));
    return { message: '删除成功' };
  }

  async addDishSpec(dto: CreateDishSpecDto) {
    const insertResult = await db.insert(dish_specs).values({
      ...dto,
      price: dto.price.toFixed(2),
    });
    const newId = (insertResult as any)[0].insertId;
    const result = await db.select().from(dish_specs).where(eq(dish_specs.id, newId));
    return result[0];
  }

  async deleteDishSpec(id: number) {
    await db.delete(dish_specs).where(eq(dish_specs.id, id));
    return { message: '删除成功' };
  }
}
