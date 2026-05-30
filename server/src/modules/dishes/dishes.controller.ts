import { Controller, Get, Post, Put, Delete, Body, Param, Query, ParseIntPipe, UseGuards } from '@nestjs/common';
import { DishesService } from './dishes.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../merchant-ops/auth/permissions.guard';
import { Audit, Permissions } from '../merchant-ops/auth/decorators';
import { CreateDishDto, UpdateDishDto, CreateDishSpecDto, CreateCategoryDto } from './dto/dish.dto';

@Controller('dishes')
export class DishesController {
  constructor(private readonly dishesService: DishesService) {}

  // ---- 公开读取（顾客浏览菜单） ----

  @Get('categories')
  async getCategories() {
    return await this.dishesService.getCategories();
  }

  @Get()
  async getDishes(@Query('category_id') categoryId?: string, @Query('include_unavailable') includeUnavailable?: string) {
    const id = categoryId ? parseInt(categoryId, 10) : undefined;
    const include = includeUnavailable === 'true';
    return await this.dishesService.getDishes(id, include);
  }

  @Get(':id')
  async getDishById(@Param('id', ParseIntPipe) id: number) {
    return await this.dishesService.getDishById(id);
  }

  // ---- 商家写操作（owner/manager 可操作） ----

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('MENU_ITEM_UPDATE')
  @Audit('MENU_ITEM_UPDATE')
  @Post('categories')
  async createCategory(@Body() dto: CreateCategoryDto) {
    return await this.dishesService.createCategory(dto);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('MENU_ITEM_UPDATE')
  @Audit('MENU_ITEM_UPDATE')
  @Put('categories/:id')
  async updateCategory(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateCategoryDto,
  ) {
    return await this.dishesService.updateCategory(id, dto);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('MENU_ITEM_UPDATE')
  @Audit('MENU_ITEM_UPDATE')
  @Delete('categories/:id')
  async deleteCategory(@Param('id', ParseIntPipe) id: number) {
    return await this.dishesService.deleteCategory(id);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('MENU_ITEM_UPDATE')
  @Audit('MENU_ITEM_UPDATE')
  @Post()
  async createDish(@Body() dto: CreateDishDto) {
    return await this.dishesService.createDish(dto);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('MENU_ITEM_UPDATE')
  @Audit('MENU_ITEM_UPDATE')
  @Put(':id')
  async updateDish(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDishDto,
  ) {
    return await this.dishesService.updateDish(id, dto);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('MENU_ITEM_UPDATE')
  @Audit('MENU_ITEM_UPDATE')
  @Post(':id/toggle')
  async toggleDishStatus(@Param('id', ParseIntPipe) id: number) {
    return await this.dishesService.toggleDishStatus(id);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('MENU_ITEM_UPDATE')
  @Audit('MENU_ITEM_UPDATE')
  @Delete(':id')
  async deleteDish(@Param('id', ParseIntPipe) id: number) {
    return await this.dishesService.deleteDish(id);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('MENU_ITEM_UPDATE')
  @Audit('MENU_ITEM_UPDATE')
  @Post('specs')
  async addDishSpec(@Body() dto: CreateDishSpecDto) {
    return await this.dishesService.addDishSpec(dto);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('MENU_ITEM_UPDATE')
  @Audit('MENU_ITEM_UPDATE')
  @Delete('specs/:id')
  async deleteDishSpec(@Param('id', ParseIntPipe) id: number) {
    return await this.dishesService.deleteDishSpec(id);
  }
}
