import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { db } from '@/storage/database/mysql-client';
import { dishes, dish_categories, dish_specs } from '@/storage/database/shared/schema';
import { CreateDishDto, UpdateDishDto, CreateDishSpecDto, CreateCategoryDto } from './dto/dish.dto';
import { eq, asc, and } from 'drizzle-orm';
import { LocalImageCleanupService } from '@/modules/merchant-ops/common/image-cleanup';

@Injectable()
export class DishesService {
  constructor(private readonly imageCleanup: LocalImageCleanupService) {}
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
    // 若 image_url 改了，先记录旧值，更新后清理本地旧图
    let oldImage: string | null | undefined;
    if (dto.image_url !== undefined) {
      const cur = await db.select({ image_url: dishes.image_url }).from(dishes).where(eq(dishes.id, id)).limit(1);
      oldImage = cur[0]?.image_url ?? null;
    }
    await db.update(dishes).set(updateData).where(eq(dishes.id, id));
    if (oldImage && oldImage !== dto.image_url) {
      void this.imageCleanup.removeByUrl(oldImage); // fire-and-forget
    }
    return await this.getDishById(id);
  }

  async toggleDishStatus(id: number) {
    const dish = await this.getDishById(id);
    const newStatus = dish.status === 'available' ? 'unavailable' : 'available';
    await db.update(dishes).set({ status: newStatus }).where(eq(dishes.id, id));
    return await this.getDishById(id);
  }

  async deleteDish(id: number) {
    // 先读取图片地址，删完表行后再清理本地文件
    // 注意：order_items 已经存了 dish_name 冗余，删菜品不影响历史订单显示
    const cur = await db.select({ image_url: dishes.image_url }).from(dishes).where(eq(dishes.id, id)).limit(1);
    const imgUrl = cur[0]?.image_url ?? null;
    await db.delete(dishes).where(eq(dishes.id, id));
    if (imgUrl) {
      void this.imageCleanup.removeByUrl(imgUrl); // fire-and-forget
    }
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
