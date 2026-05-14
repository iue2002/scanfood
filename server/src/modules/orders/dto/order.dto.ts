import { IsString, IsNumber, IsOptional, IsIn, IsArray, ValidateNested, Min } from 'class-validator';
import { Type } from 'class-transformer';

class OrderItemDto {
  @IsNumber()
  dish_id: number;

  @IsOptional()
  @IsNumber()
  spec_id?: number;

  @IsString()
  dish_name: string;

  @IsOptional()
  @IsString()
  spec_name?: string;

  @IsNumber()
  @Min(1)
  quantity: number;

  @IsNumber()
  @Min(0)
  price: number;
}

export class CreateOrderDto {
  @IsNumber()
  table_id: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];

  @IsOptional()
  @IsNumber()
  user_id?: number;

  @IsOptional()
  @IsString()
  remark?: string;
}

export class UpdateOrderDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items?: OrderItemDto[];

  @IsOptional()
  @IsString()
  remark?: string;
}

export class AddOrderItemDto {
  @IsNumber()
  dish_id: number;

  @IsOptional()
  @IsNumber()
  spec_id?: number;

  @IsString()
  dish_name: string;

  @IsOptional()
  @IsString()
  spec_name?: string;

  @IsNumber()
  @Min(1)
  quantity: number;

  @IsNumber()
  @Min(0)
  price: number;
}

export class UpdateOrderStatusDto {
  @IsString()
  @IsIn(['submitted', 'printed', 'settled', 'cancelled', 'refunded'])
  status: string;
}
