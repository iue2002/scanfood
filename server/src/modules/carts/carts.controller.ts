import { Controller, Get, Post, Delete, Body, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CartsService } from './carts.service';
import { CreateCartDto } from './dto/cart.dto';

@Controller('carts')
export class CartsController {
  constructor(private readonly cartsService: CartsService) {}

  @UseGuards(JwtAuthGuard)
  @Get('current/:tableId')
  async getTableCurrentCart(@Param('tableId', ParseIntPipe) tableId: number) {
    return await this.cartsService.getTableCurrentCart(tableId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('sync')
  async syncCart(@Body() dto: CreateCartDto) {
    return await this.cartsService.syncCart(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async deleteCart(@Param('id', ParseIntPipe) id: number) {
    return await this.cartsService.deleteCart(id);
  }
}
