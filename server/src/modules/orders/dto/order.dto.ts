import { IsString, IsNumber, IsOptional, IsNotEmpty, IsArray, IsEnum, IsBoolean } from 'class-validator';

export class CreateOrderDto {
  @IsNumber()
  table_id: number;

  @IsArray()
  items: Array<{
    dish_id: number;
    spec_id?: number;
    dish_name: string;
    spec_name?: string;
    quantity: number;
    price: number;
    added_by_user_id?: number;
    added_by_nickname?: string;
  }>;

  @IsNumber()
  @IsOptional()
  user_id?: number;

  @IsString()
  @IsOptional()
  remark?: string;
}

export class AddOrderItemDto {
  @IsNumber()
  dish_id: number;

  @IsNumber()
  @IsOptional()
  spec_id?: number;

  @IsString()
  @IsNotEmpty()
  dish_name: string;

  @IsString()
  @IsOptional()
  spec_name?: string;

  @IsNumber()
  quantity: number;

  @IsNumber()
  price: number;
}

export class UpdateOrderStatusDto {
  @IsString()
  @IsEnum(['draft', 'submitted', 'printed', 'settled', 'cancelled', 'refunded'])
  status: string;
}

export class UpdateOrderItemServedDto {
  @IsBoolean()
  served: boolean;
}
