import { IsString, IsNumber, IsOptional, IsNotEmpty, IsArray, IsEnum, IsBoolean, Min, Max, MaxLength, Matches, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

const NO_XSS = /^[^<>]*$/;

// 订单菜品项校验
export class OrderItemDto {
  @IsNumber()
  @Min(1)
  dish_id: number;

  @IsNumber()
  @IsOptional()
  spec_id?: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(NO_XSS)
  dish_name: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  spec_name?: string;

  @IsNumber()
  @Min(1)
  @Max(999)
  quantity: number;

  @IsNumber()
  @Min(0)
  @Max(999999)
  price: number;

  @IsNumber()
  @IsOptional()
  added_by_user_id?: number;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  added_by_nickname?: string;
}

export class CreateOrderDto {
  // 堂食必传；外带可不传（后端自动填虚拟打包桌）
  @IsNumber()
  @IsOptional()
  table_id?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];

  @IsNumber()
  @IsOptional()
  user_id?: number;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  remark?: string;

  // dine_in=堂食, takeaway=外带打包；外带订单 table_id 由后端自动指向虚拟"打包"桌
  @IsString()
  @IsOptional()
  order_type?: string;
}

// sync-add-more 请求体
export class SyncAddMoreDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];
}

export class AddOrderItemDto {
  @IsNumber()
  dish_id: number;

  @IsNumber()
  @IsOptional()
  spec_id?: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(NO_XSS)
  dish_name: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  spec_name?: string;

  @IsNumber()
  @Min(1)
  @Max(999)
  quantity: number;

  @IsNumber()
  @Min(0)
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
