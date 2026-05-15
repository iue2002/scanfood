import { Controller, Get, Post, Put, Delete, Body, Param, Query, ParseIntPipe } from '@nestjs/common';
import { DishesService } from './dishes.service';
import { CreateDishDto, UpdateDishDto, CreateDishSpecDto, CreateCategoryDto } from './dto/dish.dto';

@Controller('dishes')
export class DishesController {
  constructor(private readonly dishesService: DishesService) {}

  // 获取所有菜品分类
  @Get('categories')
  async getCategories() {
    console.log('[GET /api/dishes/categories]');
    return await this.dishesService.getCategories();
  }

  // 创建菜品分类
  @Post('categories')
  async createCategory(@Body() dto: CreateCategoryDto) {
    console.log('[POST /api/dishes/categories]', dto);
    return await this.dishesService.createCategory(dto);
  }

  // 更新菜品分类
  @Put('categories/:id')
  async updateCategory(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateCategoryDto,
  ) {
    console.log('[PUT /api/dishes/categories/:id]', { id, dto });
    return await this.dishesService.updateCategory(id, dto);
  }

  // 删除菜品分类
  @Delete('categories/:id')
  async deleteCategory(@Param('id', ParseIntPipe) id: number) {
    console.log('[DELETE /api/dishes/categories/:id]', { id });
    return await this.dishesService.deleteCategory(id);
  }

  // 获取所有菜品
  @Get()
  async getDishes(@Query('category_id') categoryId?: string, @Query('include_unavailable') includeUnavailable?: string) {
    console.log('[GET /api/dishes]', { categoryId, includeUnavailable });
    const id = categoryId ? parseInt(categoryId, 10) : undefined;
    const include = includeUnavailable === 'true';
    return await this.dishesService.getDishes(id, include);
  }

  // 获取单个菜品
  @Get(':id')
  async getDishById(@Param('id', ParseIntPipe) id: number) {
    console.log('[GET /api/dishes/:id]', { id });
    return await this.dishesService.getDishById(id);
  }

  // 创建菜品
  @Post()
  async createDish(@Body() dto: CreateDishDto) {
    console.log('[POST /api/dishes]', dto);
    return await this.dishesService.createDish(dto);
  }

  // 更新菜品
  @Put(':id')
  async updateDish(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDishDto,
  ) {
    console.log('[PUT /api/dishes/:id]', { id, dto });
    return await this.dishesService.updateDish(id, dto);
  }

  // 菜品上架/下架
  @Post(':id/toggle')
  async toggleDishStatus(@Param('id', ParseIntPipe) id: number) {
    console.log('[POST /api/dishes/:id/toggle]', { id });
    return await this.dishesService.toggleDishStatus(id);
  }

  // 删除菜品
  @Delete(':id')
  async deleteDish(@Param('id', ParseIntPipe) id: number) {
    console.log('[DELETE /api/dishes/:id]', { id });
    return await this.dishesService.deleteDish(id);
  }

  // 添加菜品规格
  @Post('specs')
  async addDishSpec(@Body() dto: CreateDishSpecDto) {
    console.log('[POST /api/dishes/specs]', dto);
    return await this.dishesService.addDishSpec(dto);
  }

  // 删除菜品规格
  @Delete('specs/:id')
  async deleteDishSpec(@Param('id', ParseIntPipe) id: number) {
    console.log('[DELETE /api/dishes/specs/:id]', { id });
    return await this.dishesService.deleteDishSpec(id);
  }
}
