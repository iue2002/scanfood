import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { db } from '@/storage/database/mysql-client';
import { dishes, dish_categories, dish_specs } from '@/storage/database/shared/schema';
import { CreateDishDto, UpdateDishDto, CreateDishSpecDto, CreateCategoryDto, UpdateSortOrderDto } from './dto/dish.dto';
import { eq, asc, and, sql, inArray } from 'drizzle-orm';
import { LocalImageCleanupService } from '@/modules/merchant-ops/common/image-cleanup';
import { PrintPlanCore } from '@/modules/merchant-ops/print/plan.core';

@Injectable()
export class DishesService {
  constructor(
    private readonly imageCleanup: LocalImageCleanupService,
    private readonly printPlanCore: PrintPlanCore,
  ) {}
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
    // 分类下若仍有菜品，dishes.category_id 是 NOT NULL 外键(RESTRICT)，直接删会抛 FK 错误(1451)
    // 变成 500；这里先校验给出明确业务提示，引导先迁移/删除菜品
    const inUse = await db
      .select({ c: sql<number>`count(*)` })
      .from(dishes)
      .where(eq(dishes.category_id, id));
    if (Number(inUse[0]?.c ?? 0) > 0) {
      throw new BadRequestException({
        code: 'CATEGORY_IN_USE',
        message: '该分类下仍有菜品，请先移动或删除这些菜品后再删除分类',
      });
    }
    await db.delete(dish_categories).where(eq(dish_categories.id, id));
    // 删除分类后，把所有打印方案 slice 中的引用清理掉（fire-and-forget；失败不影响主删除）
    void this.printPlanCore.onCategoryDeleted(id).catch(() => undefined);
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
    // 自动分配 sort_order：取当前分类最大值 + 10，确保新菜品排在最后
    const maxResult = await db
      .select({ maxOrder: sql<number>`COALESCE(MAX(${dishes.sort_order}), 0)` })
      .from(dishes)
      .where(eq(dishes.category_id, dto.category_id));
    const nextSortOrder = (maxResult[0]?.maxOrder ?? 0) + 10;

    const insertResult = await db.insert(dishes).values({
      ...dto,
      price: dto.price.toFixed(2),
      status: 'available',
      sort_order: nextSortOrder,
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

  async updateSortOrder(dto: UpdateSortOrderDto) {
    if (!Array.isArray(dto.items) || dto.items.length === 0) {
      throw new BadRequestException('排序数据不能为空');
    }

    // 防御：id 必须是正整数（DTO 已校验，这里再兜一层，杜绝任何注入风险）
    const items = dto.items
      .map((it, idx) => ({ id: Number(it.id), order: (idx + 1) * 10 }))
      .filter((it) => Number.isInteger(it.id) && it.id > 0);
    if (items.length === 0) {
      throw new BadRequestException('排序数据无效');
    }

    // 单条 SQL CASE WHEN 批量更新：一次往返 + 原子（替代原先循环逐条 await，
    // 既消除 N 次 DB 往返，又避免中途失败留下半排序脏状态）
    const caseBranches = sql.join(
      items.map((it) => sql`WHEN ${it.id} THEN ${it.order}`),
      sql` `,
    );
    const ids = items.map((it) => it.id);
    await db
      .update(dishes)
      .set({ sort_order: sql`CASE ${dishes.id} ${caseBranches} ELSE ${dishes.sort_order} END` })
      .where(inArray(dishes.id, ids));

    return { message: '排序已保存' };
  }
}
